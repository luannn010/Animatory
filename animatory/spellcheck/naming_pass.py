# animatory/spellcheck/naming_pass.py
from __future__ import annotations

import re
from collections import Counter

from animatory.spellcheck.checker import Finding
from animatory.spellcheck.dictionary import is_valid_word

# Capitalised tokens (incl. Vietnamese diacritics) of length >= 2. We accept all
# and rely on frequency clustering to find inconsistent proper nouns.
_NAME_RE = re.compile(r"\b([A-ZĐÀ-Ỹ][\wÀ-ỹ]{1,})\b")


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def naming_findings(text: str) -> list[Finding]:
    """Flag minority spellings of near-duplicate proper nouns across the whole
    document. Deterministic edit-distance clustering — no LLM call. Findings
    carry global offsets into `text`."""
    tokens = [(m.group(1), m.start()) for m in _NAME_RE.finditer(text)]
    counts = Counter(tok for tok, _ in tokens)
    names = list(counts)

    # Cluster names within edit-distance 1 of a strictly more frequent name.
    canonical: dict[str, str] = {}
    for name in names:
        best = None
        for other in names:
            if other == name or counts[other] <= counts[name]:
                continue
            if _levenshtein(name, other) == 1 and abs(len(name) - len(other)) <= 1:
                if best is None or counts[other] > counts[best]:
                    best = other
        if best is not None:
            canonical[name] = best

    out: list[Finding] = []
    for tok, start in tokens:
        target = canonical.get(tok)
        if target is None:
            continue
        if is_valid_word(tok):
            continue  # Layer 1: a real word is never a naming error
        out.append(Finding(
            type="naming", original=tok, suggestion=target,
            char_start=start, char_end=start + len(tok),
            reason=f"inconsistent with dominant spelling “{target}”",
        ))
    return out


def _name_tokens(known: dict) -> list[str]:
    """Canonical single-word name tokens from the registry (characters +
    locations), e.g. 'Tiêu Lan Nhi' -> ['Tiêu', 'Lan', 'Nhi']. Length >= 2."""
    toks: list[str] = []
    seen: set[str] = set()
    for name in (known.get("characters", []) or []) + (known.get("locations", []) or []):
        if not isinstance(name, str):
            continue
        for m in _NAME_RE.finditer(name):
            t = m.group(1)
            if len(t) >= 2 and t.casefold() not in seen:
                seen.add(t.casefold())
                toks.append(t)
    return toks


def registry_name_findings(text: str, known: dict, *, max_distance: int = 1) -> list[Finding]:
    """Layer 2 — flag tokens that are a near-miss of a REGISTERED canonical name.

    Deterministic, no LLM. A token is flagged only when it is (a) NOT a valid
    dictionary word, (b) not equal to any canonical name token, and (c) within
    edit-distance ``max_distance`` (default 1) of one. A function word like
    'đừng' is never within edit-distance of a character name, so it is never
    flagged here — this is the correct naming pass."""
    canon = _name_tokens(known)
    if not canon:
        return []
    canon_keys = {c.casefold() for c in canon}

    out: list[Finding] = []
    for m in _NAME_RE.finditer(text):
        tok = m.group(1)
        key = tok.casefold()
        if key in canon_keys:
            continue                       # correctly spelled registered name
        if is_valid_word(tok):
            continue                       # real word — not a name typo (Layer 1)
        best: str | None = None
        best_d = max_distance + 1
        for c in canon:
            if abs(len(c) - len(tok)) > max_distance:
                continue
            d = _levenshtein(key, c.casefold())
            if 0 < d <= max_distance and d < best_d:
                best, best_d = c, d
        if best is not None:
            out.append(Finding(
                type="naming", original=tok, suggestion=best,
                char_start=m.start(), char_end=m.start() + len(tok),
                reason=f"edit-distance-{best_d} from registered name “{best}”",
            ))
    return out


def combined_naming_findings(text: str, known: dict) -> list[Finding]:
    """The deterministic naming layer the router streams: registry near-misses
    (authoritative) plus document-frequency minority spellings, deduplicated by
    (offset, token). No LLM, no randomness — same input ⇒ same findings, so
    chunk 1 and chunk 7 agree by construction."""
    seen: set[tuple[int, str]] = set()
    out: list[Finding] = []
    for f in registry_name_findings(text, known) + naming_findings(text):
        key = (f.char_start, f.original)
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out
