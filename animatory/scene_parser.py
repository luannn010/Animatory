# animatory/scene_parser.py
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path

import httpx

from animatory import entity_registry
from animatory.voice_profiles import aggregate

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)

EMOTIONS = [
    "neutral", "happy", "sad", "angry", "fearful", "surprised",
    "tender", "mocking", "commanding", "anxious", "determined", "disgusted",
]
INTENSITIES = ["low", "medium", "high"]

# Shared rules for the beats-locator contract. The model classifies and points;
# code lifts every actual string from the source. No curly braces here so the
# block is safe to concatenate into .format() templates.
_BEAT_RULES = """\
Hard rules (POINTER extraction — this is the whole point):
- You output LOCATORS only — NEVER narration or dialogue TEXT. Each
  start_anchor / end_anchor MUST be an exact substring copied from the text
  above: do NOT paraphrase, translate, summarize, or fix typos. Anchors only
  locate the beat; code lifts the real text.
- Make each anchor long enough (4-8 words) to be UNIQUE within the text; if the
  opening words repeat, extend the anchor until it is unambiguous.
- Beats are CONSECUTIVE and cover the WHOLE text in order — no gaps, no overlap.
  Connective / action text between quotes is its own narration or action beat.
- Split at the quotation mark: text inside "..." is a dialogue beat; the speech
  tag and everything outside the quotes is narration / action. Quote marks are
  the reliable dialogue boundary in this text — anchor dialogue beats on the ".
- Attribution is EVIDENCE-BASED, never positional. Assign a speaker only from a
  speech tag (before OR after the quote: "X nói / đáp / mắng / quát / lạnh
  giọng"), a vocative (a name being ADDRESSED implies a DIFFERENT speaker), or
  unambiguous context. Do NOT assume speakers simply alternate. A reply to an
  insult is the OTHER party — e.g. 'Mẹ kiếp, Tiêu Lan Nhi, ...' addressed TO
  Tiêu Lan Nhi means the speaker is NOT Tiêu Lan Nhi. Resolve epithets to the
  person ("bản quan / ngự sử / lão già" -> the censor; "tiểu công gia / thiếu
  gia" -> the young noble; "giáo úy / tuần phòng" -> the patrol officer).
- speaker_cue is a VERBATIM snippet from the text that justifies the speaker, or
  "none". With no real cue, set speaker to "Unknown" and speaker_confidence
  "low" — never collapse every line onto one name.
- dialogue beats hold words spoken ALOUD only. Crowd / action beats, sound cues,
  and inner thoughts ("trong lòng nghĩ", "thầm nghĩ", "tự nhủ", "nghĩ bụng") are
  narration or action, never a dialogue beat.
- emotion from the listed set (omit if unclear); intensity optional.
"""

# One beat object, shared verbatim across templates (braces doubled for .format).
_BEAT_SCHEMA = """\
    {{
      "type": "narration | dialogue | action",
      "start_anchor": "first 4-8 words of this beat, copied VERBATIM",
      "end_anchor": "last 4-8 words of this beat, copied VERBATIM",
      "speaker": "character name | Unknown  (dialogue beats only)",
      "speaker_cue": "verbatim snippet justifying the speaker, or none",
      "speaker_confidence": "high | low",
      "emotion": "one of: {emotions}",
      "intensity": "one of: {intensities}"
    }}"""

_PROMPT_TEMPLATE = (
    """\
You are a Vietnamese novel-to-animation production assistant.
Extract a complete shot list from the chapter text below as SCENES, each made of
ordered BEATS that tile the scene start-to-end. Each beat is a POINTER (anchors +
labels), NOT text. Return ONLY valid JSON matching this schema - no markdown:

{{
  "chunk_id": "{chunk_id}",
  "scenes": [
    {{
      "scene_id": "{chunk_id}_S01",
      "location": "string",
      "shot_type": "wide | medium | close-up | insert | POV",
      "mood": "string",
      "beats": [
"""
    + _BEAT_SCHEMA
    + """
      ]
    }}
  ]
}}

"""
    + _BEAT_RULES
    + """\
- A long argument with several speakers should be split into MULTIPLE scenes
  rather than one giant scene — this keeps attribution accurate.
- Known names — use EXACTLY these spellings wherever they appear:
  characters: {known_characters}
  locations: {known_locations}

Chapter text:
---
{chunk_text}
---""")

_REPARSE_TEMPLATE = (
    """\
You are a Vietnamese novel-to-animation production assistant.
Re-extract a SINGLE scene from the chapter text below. You are CORRECTING one
existing scene — fix wrong speaker attribution and narration-vs-dialogue
boundaries. Output the corrected scene as ordered BEATS that tile the scene; each
beat is a POINTER (anchors + labels), NOT text.

Return ONLY one JSON object (NOT an array, no markdown), keeping the SAME id:

{{
  "scene_id": "{scene_id}",
  "location": "string",
  "shot_type": "wide | medium | close-up | insert | POV",
  "mood": "string",
  "beats": [
"""
    + _BEAT_SCHEMA
    + """
  ]
}}

"""
    + _BEAT_RULES
    + """\
- Known names — use EXACTLY these spellings:
  characters: {known_characters}
  locations: {known_locations}

The scene to re-extract currently looks like this (use it to locate the right
part of the chapter):
{anchor}

Chapter text:
---
{chunk_text}
---""")


# ── two-phase (segment → extract) templates ──────────────────────────────────

_SEGMENT_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Split the chapter text below into consecutive SCENES. A scene is one continuous
beat (same location / time / participants). A long multi-speaker argument should
be split into SEVERAL scenes.

Return ONLY valid JSON - no explanation, no markdown:

{{
  "segments": [
    {{
      "scene_id": "{chunk_id}_S01",
      "location": "string",
      "characters": ["string"],
      "start_anchor": "first 6-10 words of the scene, copied VERBATIM",
      "end_anchor": "last 6-10 words of the scene, copied VERBATIM"
    }}
  ]
}}

Rules:
- Segments are CONSECUTIVE and cover the WHOLE text in order (no gaps/overlaps).
- Anchors MUST be exact substrings copied from the text — do NOT paraphrase or
  translate. They are used to locate the scene in the raw text.
- Number scene_id sequentially: {chunk_id}_S01, {chunk_id}_S02, ...
- Known names — use EXACTLY these spellings:
  characters: {known_characters}
  locations: {known_locations}

Chapter text:
---
{chunk_text}
---"""

_SCENE_EXTRACT_TEMPLATE = (
    """\
You are a Vietnamese novel-to-animation production assistant.
Extract ONE scene from the scene text below as an ordered list of BEATS that tile
the scene start-to-end. Each beat is a POINTER (anchors + labels), NOT text.
Return ONLY one JSON object (NOT an array, no markdown), keeping the given id:

{{
  "scene_id": "{scene_id}",
  "location": "string",
  "shot_type": "wide | medium | close-up | insert | POV",
  "mood": "string",
  "beats": [
"""
    + _BEAT_SCHEMA
    + """
  ]
}}

"""
    + _BEAT_RULES
    + """\
- Hint for this scene — location: {hint_location}; characters: {hint_characters}.
- Known names — use EXACTLY these spellings:
  characters: {known_characters}
  locations: {known_locations}

Scene text:
---
{scene_text}
---""")

def _qwen_env(
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> tuple[str, str, int, float, bool]:
    """Resolve Qwen connection settings from args/env.

    Returns (endpoint, model_name, retries, timeout_s, enable_thinking).
    Qwen3.5 emits chain-of-thought by default, which is slow; we disable thinking
    unless QWEN_ENABLE_THINKING=1.
    """
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))
    enable_thinking = os.environ.get("QWEN_ENABLE_THINKING", "0") == "1"
    return endpoint, model_name, retries, timeout_s, enable_thinking


class ChatUnavailableError(RuntimeError):
    """The chat/LLM endpoint is unreachable (e.g. hibernated for image generation) and
    could not be woken. Carries an actionable, user-facing message. The parse/reparse
    preflight raises this *before* the expensive 3x retry loop so the failure is fast and
    clear (the API maps it to HTTP 503)."""


async def _chat_reachable(endpoint: str, timeout_s: float) -> bool:
    """True if the chat server answers ``GET /v1/models`` with 200."""
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(f"{endpoint}/v1/models")
            return resp.status_code == 200
    except httpx.HTTPError:
        return False


async def ensure_chat_available(
    endpoint: str,
    *,
    probe_timeout_s: float = 3.0,
    wake_wait_s: float = 45.0,
    poll_s: float = 3.0,
) -> None:
    """Preflight the chat endpoint before parsing/reparsing.

    If reachable, return immediately. Otherwise try to wake the brain via the workerd
    control plane and poll until the chat server comes up. If it stays down (or the control
    plane is disabled/unreachable), raise :class:`ChatUnavailableError` with an actionable
    message — failing fast instead of grinding through the per-call retry loop and dumping a
    503 traceback.

    Disabled (no-op) when ``CHAT_PREFLIGHT`` != "1" (tests set it off; production leaves it on).
    """
    if os.environ.get("CHAT_PREFLIGHT", "1") != "1":
        return
    if await _chat_reachable(endpoint, probe_timeout_s):
        return

    woke = False
    try:
        from animatory.zimage import brain  # local import: optional control-plane dependency

        woke = await asyncio.to_thread(brain.BrainClient().wake)
    except Exception as exc:  # pragma: no cover - control plane is optional
        logger.debug("[chat] brain wake attempt failed: %s", exc)

    if woke:
        logger.info("[chat] brain wake requested; waiting up to %.0fs for %s", wake_wait_s, endpoint)
        deadline = asyncio.get_event_loop().time() + wake_wait_s
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(poll_s)
            if await _chat_reachable(endpoint, probe_timeout_s):
                logger.info("[chat] %s is up after brain wake", endpoint)
                return

    raise ChatUnavailableError(
        f"chat model is not reachable at {endpoint} — it may be hibernated for image "
        "generation. Start the chat server on that port, or enable the brain control plane "
        "(BRAIN_CONTROL_ENABLED, plus BRAIN_VIA_WSL on Windows) so it can be woken "
        "automatically, then retry."
    )


async def _call_qwen(
    prompt: str,
    *,
    label: str,
    endpoint: str,
    model_name: str,
    retries: int,
    timeout_s: float,
    enable_thinking: bool,
) -> dict:
    """POST one chat-completion, strip thinking + markdown fences, return parsed
    JSON. Retries with exponential backoff. Raises ValueError after `retries`
    attempts. `label` identifies the caller in log lines / the error message."""
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "chat_template_kwargs": {"enable_thinking": enable_thinking},
    }

    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        if attempt > 1:
            await asyncio.sleep(2 ** (attempt - 1))
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(f"{endpoint}/v1/chat/completions", json=payload)
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                cleaned = _THINKING_RE.sub("", raw).strip()
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                data = json.loads(cleaned)
                logger.info("[qwen] %s attempt %d/%d OK", label, attempt, retries)
                return data
        except httpx.HTTPError as exc:
            logger.warning(
                "[qwen] %s attempt %d/%d: cannot reach Qwen at %s -> %s",
                label, attempt, retries, endpoint, repr(exc),
            )
            # repr() is used because ReadError/ConnectError stringify to an empty message.
            last_exc = exc
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning(
                "[qwen] %s attempt %d/%d: invalid response from Qwen -> %s",
                label, attempt, retries, repr(exc),
            )
            last_exc = exc

    if isinstance(last_exc, httpx.HTTPError):
        reason = f"could not reach Qwen endpoint {endpoint}/v1/chat/completions"
    else:
        reason = "could not parse JSON from Qwen response"
    raise ValueError(
        f"{reason} for {label} after {retries} attempts "
        f"(last error: {type(last_exc).__name__}: {last_exc})"
    ) from last_exc


def _main_prompt(chunk_id: str, chunk_text: str, known: dict) -> str:
    return _PROMPT_TEMPLATE.format(
        chunk_id=chunk_id,
        chunk_text=chunk_text,
        emotions=", ".join(EMOTIONS),
        intensities=" | ".join(INTENSITIES),
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
    )


async def segment_chunk(chunk_id: str, chunk_text: str, known: dict, **qwen) -> list[dict]:
    """Phase 1: ask the model only for scene boundaries (verbatim anchors)."""
    prompt = _SEGMENT_TEMPLATE.format(
        chunk_id=chunk_id,
        chunk_text=chunk_text,
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
    )
    data = await _call_qwen(prompt, label=f"{chunk_id}/segment", **qwen)
    segments = data.get("segments", [])
    return segments if isinstance(segments, list) else []


def _slice_by_anchors(text: str, segments: list[dict]) -> list[tuple[dict, str]]:
    """Map each segment's verbatim start_anchor to an offset and cut the raw text
    into consecutive, gap-free slices. Robust to anchors the model couldn't copy
    exactly: such a segment falls back to continuing from the previous cursor."""
    starts: list[int] = []
    cursor = 0
    for seg in segments:
        anchor = (seg.get("start_anchor") or "").strip()
        idx = text.find(anchor, cursor) if anchor else -1
        if idx == -1 and anchor:
            idx = text.find(anchor)  # search from the top
        if idx == -1:
            idx = cursor  # anchor not found — continue from where we are
        starts.append(idx)
        cursor = max(cursor, idx + 1)

    out: list[tuple[dict, str]] = []
    n = len(segments)
    for i, seg in enumerate(segments):
        start = starts[i]
        end = starts[i + 1] if i + 1 < n else len(text)
        if end <= start:
            end = len(text) if i + 1 == n else start + 1
        slice_text = text[start:end].strip()
        if slice_text:
            out.append((seg, slice_text))
    return out


# ── pointer-based beat resolution (the correctness guarantee) ────────────────
#
# The model emits ordered *locators* (anchors + labels), never prose. Code lifts
# every actual string from the source, so narration/dialogue text is a pure
# substring of the scene slice by construction — corruption is structurally
# impossible, not merely validated away.

_BEAT_PASSTHROUGH = (
    "speaker", "speaker_cue", "speaker_confidence", "emotion", "intensity",
)


def _resolve_beats(scene_text: str, beats: list[dict]) -> list[dict]:
    """Resolve each beat's verbatim anchors to ``[start, end)`` offsets in
    ``scene_text`` and tile the whole scene with no gaps or overlaps.

    Each returned beat carries its lifted ``text`` (an exact substring of the
    source, source typos and all), its ``start``/``end`` offsets, and any
    classified passthrough fields (speaker, emotion, ...). Gaps between beats are
    recovered as inferred ``narration`` beats (``inferred: True``) rather than
    dropped; a beat whose anchors cannot be located is flagged
    (``beat_unresolved: True``) and the scene continues.

    The resolved spans are contiguous and cover ``[0, len(scene_text))`` exactly,
    so ``"".join(scene_text[b['start']:b['end']] for b in result) == scene_text``.
    """
    n = len(scene_text)

    # Pass 1 — locate each beat via a single forward sweep (the cursor starts at
    # the previous beat's resolved end, which enforces order and disambiguates
    # repeated opening anchors).
    raw: list[dict] = []
    cursor = 0
    for beat in beats:
        sa = (beat.get("start_anchor") or "").strip()
        ea = (beat.get("end_anchor") or "").strip()
        unresolved = False

        start = scene_text.find(sa, cursor) if sa else -1
        if start == -1:
            start = cursor
            if sa:
                unresolved = True

        end: int | None = None
        if ea:
            e = scene_text.find(ea, start)
            if e != -1:
                end = e + len(ea)
        if end is None or end <= start:
            end = None  # unknown end — filled from the next beat's start below
            if ea:
                unresolved = True

        raw.append({"beat": beat, "start": start, "end": end, "unresolved": unresolved})
        cursor = max(cursor, (end if end is not None else start) + 1)

    # Pass 2 — stitch resolved beats into a strictly contiguous tiling. Whitespace
    # between beats is absorbed into the following beat; non-whitespace gaps are
    # surfaced as inferred narration so no source text is ever lost.
    out: list[dict] = []

    def _emit(start: int, end: int, beat: dict | None, unresolved: bool) -> None:
        fields = {"start": start, "end": end, "text": scene_text[start:end].strip()}
        if beat is None:
            fields["type"] = "narration"
            fields["inferred"] = True
        else:
            fields["type"] = beat.get("type") or "narration"
            for key in _BEAT_PASSTHROUGH:
                if key in beat:
                    fields[key] = beat[key]
            if unresolved:
                fields["beat_unresolved"] = True
        out.append(fields)

    pos = 0
    for i, r in enumerate(raw):
        start = r["start"]
        next_start = raw[i + 1]["start"] if i + 1 < len(raw) else n

        if start > pos:
            gap = scene_text[pos:start]
            if gap.strip():
                _emit(pos, start, None, False)  # recover dropped source as a beat
            # else: leading/inter-beat whitespace — absorb into this beat
            pos = max(pos, start) if gap.strip() else pos
            start = pos
        else:
            start = pos  # overlap or fallback: keep the first beat, clamp start

        end = r["end"]
        if end is None or end <= start:
            end = next_start
        if end > next_start:
            end = next_start  # overlap into the next beat: keep first in order
        if end < start:
            end = start

        _emit(start, end, r["beat"], r["unresolved"])
        pos = end

    # Trailing source past the last beat — recover it, never drop it.
    if pos < n:
        if scene_text[pos:].strip():
            _emit(pos, n, None, False)
        elif out:
            out[-1]["end"] = n
            out[-1]["text"] = scene_text[out[-1]["start"]:n].strip()

    return out


def _assemble_scene(
    scene_id: str, scene_text: str, meta: dict, resolved: list[dict]
) -> dict:
    """Map resolved beats onto the external scene struct (pre-normalization).

    Hybrid-by-field: ``narration[]``, ``dialogue[].line`` and ``speaker_cue`` are
    lifted verbatim from the source; ``location``/``shot_type``/``mood``/
    ``emotion``/``intensity``/``speaker`` are model-classified. ``action`` is the
    concatenation of ``action``-type beats (also source-lifted). ``Unknown``
    speakers stay on their line but are kept off the character roster.
    """
    narration: list[str] = []
    dialogue: list[dict] = []
    action_parts: list[str] = []
    roster: list[str] = []
    seen: set[str] = set()

    def add_roster(name: str) -> None:
        if name and name != "Unknown" and name not in seen:
            seen.add(name)
            roster.append(name)

    for b in resolved:
        text = b.get("text") or ""
        if not text:
            continue
        btype = b.get("type")
        if btype == "dialogue":
            speaker = b.get("speaker") or "Unknown"
            entry: dict = {"character": speaker, "line": text}
            emotion = b.get("emotion")
            if emotion in EMOTIONS:
                entry["emotion"] = emotion
            intensity = b.get("intensity")
            if intensity in INTENSITIES:
                entry["intensity"] = intensity
            confidence = b.get("speaker_confidence")
            entry["speaker_confidence"] = confidence if confidence in ("high", "low") else "low"
            cue = b.get("speaker_cue") or "none"
            if cue != "none" and cue not in scene_text:
                cue = "none"  # honesty check: a cue must be a real source snippet
            entry["speaker_cue"] = cue
            dialogue.append(entry)
            add_roster(speaker)
        elif btype == "action":
            action_parts.append(text)
        else:  # narration, inferred gap-fill, or any unexpected label
            narration.append(text)

    for hint in meta.get("hint_characters") or []:
        add_roster(hint)

    return {
        "scene_id": scene_id,
        "location": meta.get("location") or "?",
        "characters": roster,
        "shot_type": meta.get("shot_type") or "medium",
        "action": " ".join(action_parts),
        "dialogue": dialogue,
        "narration": narration,
        "mood": meta.get("mood") or "",
    }


def _locate_span(corpus: str, beats: list[dict], cursor: int = 0) -> tuple[int, int]:
    """Find the ``[start, end)`` region of ``corpus`` that the beats cover, forward
    of ``cursor``. Uses the first beat's start_anchor and the last beat's
    end_anchor; falls back to ``cursor``/end-of-corpus when an anchor is missing.
    Used by the whole-corpus paths (single-pass, reparse) to carve a scene's slice
    before handing it to ``_resolve_beats``."""
    if not beats:
        return cursor, len(corpus)
    first = (beats[0].get("start_anchor") or "").strip()
    last = (beats[-1].get("end_anchor") or "").strip()
    start = corpus.find(first, cursor) if first else -1
    if start == -1:
        start = cursor
    end = corpus.find(last, start) if last else -1
    end = end + len(last) if end != -1 else len(corpus)
    if end <= start:
        end = len(corpus)
    return start, end


def _scenes_from_single_pass(chunk_id: str, chunk_text: str, scenes_meta: list) -> list[dict]:
    """Map a single-pass response (scenes, each carrying beats) onto the external
    struct. The resolution corpus is the WHOLE chunk: each scene's slice runs from
    its first beat's anchor to the next scene's first anchor (a forward sweep that
    keeps scenes in order), and beats are lifted from that slice."""
    metas = [m for m in scenes_meta if isinstance(m, dict)]
    if not metas:
        return []

    starts: list[int] = []
    cursor = 0
    for m in metas:
        beats = m.get("beats") or []
        first = (beats[0].get("start_anchor") or "").strip() if beats else ""
        idx = chunk_text.find(first, cursor) if first else -1
        if idx == -1:
            idx = cursor
        starts.append(idx)
        cursor = max(cursor, idx + 1)

    out: list[dict] = []
    n = len(metas)
    for i, m in enumerate(metas):
        start = starts[i]
        end = starts[i + 1] if i + 1 < n else len(chunk_text)
        if end <= start:
            end = len(chunk_text) if i + 1 == n else start + 1
        slice_text = chunk_text[start:end]
        resolved = _resolve_beats(slice_text, m.get("beats") or [])
        scene_id = f"{chunk_id}_S{i + 1:02d}"
        meta = {
            "location": m.get("location"),
            "shot_type": m.get("shot_type"),
            "mood": m.get("mood"),
            "hint_characters": [],
        }
        out.append(_assemble_scene(scene_id, slice_text, meta, resolved))
    return out


async def _extract_one_scene(
    scene_id: str, scene_text: str, seg: dict, known: dict, **qwen
) -> dict | None:
    """Phase 2: extract a single scene from its raw-text slice only."""
    prompt = _SCENE_EXTRACT_TEMPLATE.format(
        scene_id=scene_id,
        scene_text=scene_text,
        emotions=", ".join(EMOTIONS),
        intensities=" | ".join(INTENSITIES),
        hint_location=seg.get("location") or "?",
        hint_characters=", ".join(seg.get("characters") or []) or "?",
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
    )
    try:
        data = await _call_qwen(prompt, label=scene_id, **qwen)
    except ValueError:
        logger.warning("[two_phase] scene %s extraction failed; skipping", scene_id)
        return None
    # Tolerate a model that wraps the object in {"scenes": [...]}.
    if isinstance(data, dict) and isinstance(data.get("scenes"), list) and data["scenes"]:
        data = data["scenes"][0]
    if not isinstance(data, dict):
        return None

    beats = data.get("beats")
    resolved = _resolve_beats(scene_text, beats if isinstance(beats, list) else [])
    meta = {
        "location": data.get("location") or seg.get("location"),
        "shot_type": data.get("shot_type"),
        "mood": data.get("mood"),
        "hint_characters": seg.get("characters") or [],
    }
    return _assemble_scene(scene_id, scene_text, meta, resolved)


async def _parse_chunk_two_phase(chunk_id: str, chunk_text: str, known: dict, **qwen) -> list[dict]:
    """Segment the chunk, then extract each scene from its own raw-text slice.
    Returns [] if segmentation produced nothing (caller falls back to single-pass)."""
    segments = await segment_chunk(chunk_id, chunk_text, known, **qwen)
    pairs = _slice_by_anchors(chunk_text, segments)
    logger.info("[two_phase] chunk=%s segmented into %d scene(s)", chunk_id, len(pairs))
    if not pairs:
        return []

    concurrency = max(1, int(os.environ.get("QWEN_PARSE_CONCURRENCY", "1")))
    sem = asyncio.Semaphore(concurrency)

    async def worker(idx: int, seg: dict, slice_text: str) -> dict | None:
        scene_id = f"{chunk_id}_S{idx:02d}"
        async with sem:
            return await _extract_one_scene(scene_id, slice_text, seg, known, **qwen)

    results = await asyncio.gather(
        *(worker(i + 1, seg, txt) for i, (seg, txt) in enumerate(pairs))
    )
    return [s for s in results if s]


async def parse_chunk(
    chunk_id: str,
    chunk_text: str,
    episode_id: str,
    output_dir: Path,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> Path:
    """Call Qwen, write {chunk_id}_scenes.json into output_dir, return its path."""
    endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env(
        qwen_endpoint, model, max_retries
    )
    qwen = dict(
        endpoint=endpoint, model_name=model_name, retries=retries,
        timeout_s=timeout_s, enable_thinking=enable_thinking,
    )

    registry = entity_registry.load(episode_id, output_dir)
    known = registry.known_names()
    two_phase = os.environ.get("QWEN_TWO_PHASE", "0") == "1"

    logger.info(
        "[parse_chunk] chunk=%s episode=%s endpoint=%s model=%s chars=%d retries=%d timeout=%.0fs thinking=%s two_phase=%s",
        chunk_id, episode_id, endpoint, model_name, len(chunk_text), retries, timeout_s, enable_thinking, two_phase,
    )

    raw_scenes: list[dict] = []
    if two_phase:
        raw_scenes = await _parse_chunk_two_phase(chunk_id, chunk_text, known, **qwen)
    if not raw_scenes:
        # Single-pass (default, and fallback if segmentation yields nothing). The
        # model points at beats over the whole chunk; code lifts every string.
        scenes_data = await _call_qwen(_main_prompt(chunk_id, chunk_text, known), label=chunk_id, **qwen)
        raw_scenes = _scenes_from_single_pass(chunk_id, chunk_text, scenes_data.get("scenes", []))

    scenes = [registry.normalize_scene(s) for s in raw_scenes]
    registry.learn(scenes)
    entity_registry.save(
        registry, output_dir, now=datetime.now(timezone.utc).isoformat()
    )

    out_path = output_dir / f"{chunk_id}_scenes.json"
    result = {
        "chunk_id": chunk_id,
        "source_file": episode_id + ".txt",
        "model": model_name,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "scenes": scenes,
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[parse_chunk] chunk=%s wrote %s (%d scenes)", chunk_id, out_path, len(result["scenes"]))
    return out_path


async def reparse_scene(
    chunk_id: str,
    chunk_text: str,
    anchor_scene: dict,
    registry: entity_registry.EntityRegistry,
    *,
    scene_id: str,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> dict:
    """Re-extract a single scene from the chapter. Sends the whole chunk plus the
    scene as an anchor; consults the registry for known names and normalizes the
    result. Does NOT write files, learn, or save the registry — the caller decides
    whether to keep the result."""
    endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env(
        qwen_endpoint, model, max_retries
    )
    await ensure_chat_available(endpoint)  # fast, clear error if the chat model is down
    known = registry.known_names()
    prompt = _REPARSE_TEMPLATE.format(
        scene_id=scene_id,
        emotions=", ".join(EMOTIONS),
        intensities=" | ".join(INTENSITIES),
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
        anchor=json.dumps(anchor_scene, ensure_ascii=False, indent=2),
        chunk_text=chunk_text,
    )

    logger.info(
        "[reparse_scene] chunk=%s scene=%s chars=%d", chunk_id, scene_id, len(chunk_text)
    )

    data = await _call_qwen(
        prompt, label=scene_id, endpoint=endpoint, model_name=model_name,
        retries=retries, timeout_s=timeout_s, enable_thinking=enable_thinking,
    )

    # Accept a bare object, a list, or a {"scenes": [obj]} wrapper.
    if isinstance(data, list):
        obj = data[0] if data else {}
    elif isinstance(data, dict) and isinstance(data.get("scenes"), list):
        obj = data["scenes"][0] if data["scenes"] else {}
    else:
        obj = data
    if not isinstance(obj, dict):
        obj = {}

    # Carve the scene's slice from the whole chunk, then lift every string from it.
    beats = obj.get("beats") if isinstance(obj.get("beats"), list) else []
    start, end = _locate_span(chunk_text, beats)
    slice_text = chunk_text[start:end]
    resolved = _resolve_beats(slice_text, beats)
    meta = {
        "location": obj.get("location"),
        "shot_type": obj.get("shot_type"),
        "mood": obj.get("mood"),
        "hint_characters": [],
    }
    scene = _assemble_scene(scene_id, slice_text, meta, resolved)
    return registry.normalize_scene(scene)


ProgressFn = Callable[[int, int, str], Awaitable[None]]
EventFn = Callable[[str, dict], Awaitable[None]]


async def _enrich_episode(
    episode_id: str,
    episode_dir: Path,
    qwen_endpoint: str | None,
    on_progress: ProgressFn | None,
    total: int,
    on_event: EventFn | None = None,
) -> None:
    """Episode-scoped enrichment phases (Locations → Characters → Voices →
    descriptive Scenes). Runs after every chunk is parsed; aggregates across the
    whole episode so a description sees all of an entity's appearances. Best-effort
    and additive: failures degrade per entity and never fail the parse run. Gated
    by ``QWEN_ENRICH_ENTITIES`` (default on)."""
    from animatory import entity_enrichment  # lazy — avoids an import cycle

    endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env(qwen_endpoint)
    qwen = dict(
        endpoint=endpoint, model_name=model_name, retries=retries,
        timeout_s=timeout_s, enable_thinking=enable_thinking,
    )

    # Collect every parsed scene across the episode (edited-preferred), keeping the
    # per-chunk doc + path so summaries can be written back into the right file.
    manifest = json.loads((episode_dir / "manifest.json").read_text(encoding="utf-8"))
    chunk_docs: list[tuple[Path, dict]] = []
    all_scenes: list[dict] = []
    for c in manifest.get("chunks", []):
        cid = c["chunk_id"]
        edited = episode_dir / f"{cid}_scenes.edited.json"
        base = episode_dir / f"{cid}_scenes.json"
        path = edited if edited.exists() else base
        if not path.exists():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        chunk_docs.append((path, doc))
        all_scenes.extend(doc.get("scenes", []) or [])

    if not all_scenes:
        return

    # Voices are a pure aggregate (no LLM) — available the instant scenes exist,
    # so stream them before the slower per-entity description pass.
    if on_event is not None:
        await on_event("voice_profiles", {"profiles": aggregate(all_scenes)})
        await on_event("phase", {"phase": "describing"})

    registry = entity_registry.load(episode_id, episode_dir)
    if on_progress is not None:
        await on_progress(total, total, "entity descriptions")

    async def _on_entity(kind: str, entry: dict) -> None:
        if on_event is not None:
            singular = "character" if kind == "characters" else "location"
            await on_event("entity_described", {"kind": singular, "entry": entry})

    await entity_enrichment.enrich_entities(
        registry, all_scenes, call_fn=_call_qwen, qwen=qwen, on_entity=_on_entity,
    )
    entity_registry.save(registry, episode_dir, now=datetime.now(timezone.utc).isoformat())
    logger.info("[enrich] episode=%s described %d character(s), %d location(s)",
                episode_id, len(registry.characters), len(registry.locations))

    # Descriptive Scenes: a grounded one-line summary per scene, written back.
    if on_progress is not None:
        await on_progress(total, total, "scene summaries")
    if on_event is not None:
        await on_event("phase", {"phase": "summaries"})
    for path, doc in chunk_docs:
        scenes = doc.get("scenes", []) or []
        summaries = await entity_enrichment.describe_scenes(scenes, call_fn=_call_qwen, qwen=qwen)
        if not summaries:
            continue
        changed = False
        for s in scenes:
            sid = s.get("scene_id")
            if sid in summaries:
                s["summary"] = summaries[sid]
                changed = True
                if on_event is not None:
                    await on_event("scene_summary", {"scene_id": sid, "summary": summaries[sid]})
        if changed:
            path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


async def parse_episode(
    episode_id: str,
    episode_dir: Path,
    chunk_ids: list[str] | None = None,
    qwen_endpoint: str | None = None,
    on_progress: ProgressFn | None = None,
    on_event: EventFn | None = None,
) -> list[Path]:
    """Parse all (or selected) chunks in episode_dir. Returns list of written paths.

    If ``on_progress`` is given it is awaited with ``(done, total, chunk_id)``:
    once at the start as ``(0, total, "")`` and after each chunk completes. This
    drives the live progress bar/logs in the UI (progress == chunks done / total).

    If ``on_event`` is given it is awaited with ``(type, payload)`` for structured
    streaming: ``phase``, ``chunk_parsed`` (a chunk's scenes), then the enrichment
    events (``voice_profiles``, ``entity_described``, ``scene_summary``). It drives
    the progressive parse UI; ``on_progress`` continues to drive the log/progress bar.
    """
    manifest_path = episode_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    chunks_to_parse = [
        c for c in manifest["chunks"]
        if chunk_ids is None or c["chunk_id"] in chunk_ids
    ]
    total = len(chunks_to_parse)

    logger.info(
        "[parse_episode] episode=%s dir=%s parsing %d/%d chunk(s)",
        episode_id, episode_dir, total, len(manifest["chunks"]),
    )
    # Fail fast (and try to wake the brain) if the chat model is down, instead of grinding
    # through per-chunk retries and dumping a 503 traceback into the run record.
    await ensure_chat_available(_qwen_env(qwen_endpoint)[0])
    if on_progress is not None:
        await on_progress(0, total, "")
    if on_event is not None:
        await on_event("phase", {"phase": "scenes", "total": total})

    results = []
    for i, c in enumerate(chunks_to_parse, 1):
        logger.info(
            "[parse_episode] episode=%s chunk %d/%d (%s)",
            episode_id, i, total, c["chunk_id"],
        )
        edited_path = episode_dir / f"{c['chunk_id']}.edited.txt"
        txt_path = edited_path if edited_path.exists() else episode_dir / c["file"]
        chunk_text = txt_path.read_text(encoding="utf-8")
        path = await parse_chunk(
            chunk_id=c["chunk_id"],
            chunk_text=chunk_text,
            episode_id=episode_id,
            output_dir=episode_dir,
            qwen_endpoint=qwen_endpoint,
        )
        results.append(path)
        if on_progress is not None:
            await on_progress(i, total, c["chunk_id"])
        if on_event is not None:
            # Reveal this chunk's scenes the moment they're written.
            try:
                scenes = json.loads(path.read_text(encoding="utf-8")).get("scenes", [])
            except (json.JSONDecodeError, OSError):
                scenes = []
            await on_event("chunk_parsed", {
                "chunk_id": c["chunk_id"], "index": i, "total": total, "scenes": scenes,
            })

    logger.info("[parse_episode] episode=%s done: wrote %d file(s)", episode_id, len(results))

    if os.environ.get("QWEN_ENRICH_ENTITIES", "1") == "1":
        try:
            await _enrich_episode(episode_id, episode_dir, qwen_endpoint, on_progress, total, on_event)
        except Exception as exc:  # noqa: BLE001 — enrichment is additive, never fatal
            logger.warning("[parse_episode] episode=%s enrichment skipped: %r", episode_id, exc)

    return results
