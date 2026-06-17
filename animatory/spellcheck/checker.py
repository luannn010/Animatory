# animatory/spellcheck/checker.py
from __future__ import annotations

import hashlib
import logging
import os
from collections import OrderedDict
from dataclasses import asdict, dataclass

from animatory.llm.qwen import _call_qwen, _qwen_env
from animatory.spellcheck.dictionary import is_valid_word

logger = logging.getLogger(__name__)

_TYPES = {"spelling", "grammar", "naming"}

# Layer 3/4: the LLM is constrained to TYPOS ONLY. Every correction must carry one
# of these rules; naming/consistency is owned by the deterministic Layer 2 pass,
# so a naming-typed finding from the LLM is dropped.
_RULES = {"not-a-word", "wrong-diacritic", "misspelled-name"}

# Spellcheck runs near-deterministic: a real-word-in-context typo judgment, not
# creative text. Lower temperature than the parser's default (0.2).
_TEMPERATURE = float(os.environ.get("SPELLCHECK_TEMPERATURE", "0.1"))

# Bounded LRU: segment-text hash -> segment-LOCAL findings (offsets relative to
# the segment). Capped so a long-lived server can't grow it without limit;
# least-recently-used entries are evicted once SPELLCHECK_CACHE_MAX is exceeded.
_CACHE_MAX = max(1, int(os.environ.get("SPELLCHECK_CACHE_MAX", "256")))
_CACHE: "OrderedDict[str, list[Finding]]" = OrderedDict()


def _cache_get(key: str) -> "list[Finding] | None":
    if key not in _CACHE:
        return None
    _CACHE.move_to_end(key)  # mark most-recently-used
    return _CACHE[key]


def _cache_put(key: str, value: "list[Finding]") -> None:
    _CACHE[key] = value
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)  # evict least-recently-used

_TEMPLATE = """\
You are a Vietnamese proofreader for a novel-to-animation script.
Find TYPOS ONLY in the text below: words that are not valid Vietnamese, or have
wrong/missing diacritics, or are misspelled names. Nothing else.

Return ONLY valid JSON - no explanation, no markdown, no code fences:

{{
  "findings": [
    {{
      "type": "spelling",
      "original": "exact wrong substring copied VERBATIM from the text",
      "suggestion": "corrected text",
      "char_start": 0,
      "char_end": 0,
      "rule": "not-a-word | wrong-diacritic | misspelled-name",
      "reason": "short reason"
    }}
  ]
}}

Rules:
- "original" MUST be an exact substring of the text.
- char_start/char_end are 0-based indices INTO THE TEXT BELOW; char_end is
  exclusive so text[char_start:char_end] == original.
- TYPOS ONLY. Do NOT report naming/consistency, grammar, style, or meaning.
  Naming consistency is handled separately — do not flag it.
- NEVER replace a validly-spelled word with a DIFFERENT word. If "original" is a
  real Vietnamese word and "suggestion" is a different real word, that is a
  meaning change, not a typo — do NOT report it. (e.g. để -> đó is forbidden.)
- Every finding MUST carry a "rule": one of not-a-word | wrong-diacritic |
  misspelled-name. No valid rule => do not report it.
- These names/locations are the canonical authority — treat them as correctly
  spelled, and only flag a token as "misspelled-name" if it is a near-miss of one:
  characters: {known_characters}
  locations: {known_locations}
- If there are no typos, return {{"findings": []}}.

Text:
---
{text}
---"""


@dataclass
class Finding:
    type: str
    original: str
    suggestion: str
    char_start: int
    char_end: int
    reason: str
    rule: str = ""          # additive: not-a-word | wrong-diacritic | misspelled-name

    def to_dict(self) -> dict:
        return asdict(self)


def clear_cache() -> None:
    _CACHE.clear()


def _seg_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _closest_occurrence(haystack: str, needle: str, expected: int) -> int:
    """Index of the occurrence of `needle` nearest `expected`, or -1 if absent.
    Ties resolve to the earlier occurrence (deterministic)."""
    best = -1
    pos = haystack.find(needle)
    while pos >= 0:
        if best < 0 or abs(pos - expected) < abs(best - expected):
            best = pos
        pos = haystack.find(needle, pos + 1)
    return best


def _coerce_local(segment_text: str, raw: list) -> list[Finding]:
    """Validate raw LLM findings against the segment (local offsets) and apply the
    Layer 4 deterministic gate. Keeps a finding only when it is a real typo:

    * its span actually equals `original` (relocate/drop otherwise);
    * `suggestion` differs from `original`;
    * it carries a valid typo `rule` (no rule => not a typo, drop);
    * its `type` is not `naming` (consistency is owned by the deterministic pass);
    * `original` and `suggestion` are NOT both valid words (a same-meaning swap
      like `để -> đó` is a meaning change, not a typo).
    """
    out: list[Finding] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        original = item.get("original")
        suggestion = item.get("suggestion")
        ftype = item.get("type", "spelling")
        rule = item.get("rule", "")
        if ftype == "naming" or ftype not in _TYPES:
            # The LLM no longer adjudicates naming; anything not a known typo type
            # collapses to spelling, and naming is dropped outright.
            if ftype == "naming":
                continue
            ftype = "spelling"
        if rule not in _RULES:
            continue  # Layer 4: no valid typo rule => not a real finding
        try:
            start = int(item.get("char_start"))
            end = int(item.get("char_end"))
        except (TypeError, ValueError):
            continue
        if not original or suggestion is None or suggestion == original:
            continue
        # Same-meaning swap: both sides are real words => meaning change, not typo.
        if is_valid_word(original) and is_valid_word(suggestion):
            continue
        # Trust the substring, not the model's arithmetic: relocate if the given
        # span doesn't match, drop if the substring isn't present at all. When
        # `original` repeats, bind to the occurrence closest to the model's
        # `start` (mirrors the frontend relocate) rather than always the first.
        if segment_text[start:end] != original:
            idx = _closest_occurrence(segment_text, original, start)
            if idx < 0:
                continue
            start, end = idx, idx + len(original)
        out.append(Finding(ftype, original, suggestion, start, end, item.get("reason", ""), rule))
    return out


async def check_segment(segment_text: str, *, char_offset: int, known: dict) -> list[Finding]:
    """Proofread one segment and return findings with GLOBAL offsets.

    Findings are cached by segment-text hash (local offsets), so re-checking an
    unchanged segment spends no tokens. Raises ValueError if the LLM call cannot
    be parsed after retries — the caller turns that into a per-segment error."""
    key = _seg_hash(segment_text)
    local = _cache_get(key)
    if local is None:
        endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env()
        prompt = _TEMPLATE.format(
            text=segment_text,
            known_characters=", ".join(known.get("characters", [])) or "(none yet)",
            known_locations=", ".join(known.get("locations", [])) or "(none yet)",
        )
        data = await _call_qwen(
            prompt, label="spellcheck", endpoint=endpoint, model_name=model_name,
            retries=retries, timeout_s=timeout_s, enable_thinking=enable_thinking,
            temperature=_TEMPERATURE,
        )
        local = _coerce_local(segment_text, data.get("findings", []))
        _cache_put(key, local)

    return [
        Finding(f.type, f.original, f.suggestion,
                f.char_start + char_offset, f.char_end + char_offset, f.reason, f.rule)
        for f in local
    ]
