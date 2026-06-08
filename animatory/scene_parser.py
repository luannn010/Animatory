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

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)

EMOTIONS = [
    "neutral", "happy", "sad", "angry", "fearful", "surprised",
    "tender", "mocking", "commanding", "anxious", "determined", "disgusted",
]
INTENSITIES = ["low", "medium", "high"]

_PROMPT_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Extract a complete shot list from the following chapter text.
Return ONLY valid JSON matching this schema - no explanation, no markdown:

{{
  "chunk_id": "{chunk_id}",
  "scenes": [
    {{
      "scene_id": "{chunk_id}_S01",
      "location": "string",
      "characters": ["string"],
      "shot_type": "wide | medium | close-up | insert | POV",
      "action": "string",
      "dialogue": [
        {{"character": "string", "line": "string", "emotion": "one of: {emotions}", "intensity": "one of: {intensities}"}}
      ],
      "narration": ["string"],
      "mood": "string"
    }}
  ]
}}

Rules:
- SPEAKER ATTRIBUTION IS THE #1 PRIORITY. Assign every dialogue line to the
  character who actually says it:
  * Use the speech tag next to the quote — it may come BEFORE or AFTER the line:
    "X nói / đáp / hỏi / mắng / quát / hét / gầm lên / lạnh giọng / cười nói".
  * In a back-and-forth, speakers ALTERNATE. Do NOT assign several consecutive
    different lines to the same character unless the text explicitly says so.
  * Resolve titles / epithets to the actual person, e.g. "bản quan / ngự sử
    đương triều / lão già" (the lecturing official) → the censor character;
    "tiểu công gia / thiếu gia" → the young noble; "giáo úy / tuần phòng" → the
    patrol officer (a DISTINCT speaker). Reply to an insult is the OTHER party.
  * NEVER default to repeating one name for everything. If a line's speaker is
    genuinely unidentifiable, set "character" to "Unknown" — do not reuse a name
    that happens to appear nearby.
- "dialogue" = ONLY words spoken ALOUD. These are NOT dialogue — put them in
  "narration" (or "action"), never as a spoken line with a character:
  * crowd / action beats: "Cả đám lập tức vây quanh hắn", "hắn bị đánh tơi tả"
  * sound cues / description: "một giọng cười lạnh vang lên"
  * inner thoughts: "trong lòng nghĩ / mắng thầm", "thầm nghĩ", "tự nhủ",
    "nghĩ bụng" — the character does NOT say these out loud.
- Choose "emotion" from the listed set (omit if genuinely unclear); "intensity"
  is optional.
- Known names — use EXACTLY these spellings wherever they appear:
  characters: {known_characters}
  locations: {known_locations}
- A long argument with several speakers should usually be split into multiple
  scenes/beats rather than one giant scene — this keeps attribution accurate.

Chapter text:
---
{chunk_text}
---"""

_REPARSE_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Re-extract a SINGLE scene from the chapter text below. You are CORRECTING one
existing scene — fix mistakes: wrong speaker attribution, narration mistaken for
dialogue (or vice versa), wrong character/location spelling, and emotions.

Return ONLY one scene as valid JSON (a single object, NOT an array, no markdown)
matching this schema, keeping the SAME "scene_id":

{{
  "scene_id": "{scene_id}",
  "location": "string",
  "characters": ["string"],
  "shot_type": "wide | medium | close-up | insert | POV",
  "action": "string",
  "dialogue": [
    {{"character": "string", "line": "string", "emotion": "one of: {emotions}", "intensity": "one of: {intensities}"}}
  ],
  "narration": ["string"],
  "mood": "string"
}}

Rules:
- SPEAKER ATTRIBUTION IS THE #1 FIX. Re-derive each line's speaker from its
  speech tag (before OR after the quote: "X nói/đáp/mắng/quát/hét/lạnh giọng").
  In an exchange speakers ALTERNATE — do NOT attribute consecutive different
  lines to the same character. A reply to an insult/accusation is the OTHER
  party, not the accuser. Resolve epithets: "bản quan / ngự sử / lão già" → the
  censor; "tiểu công gia / thiếu gia" → the young noble; "giáo úy / tuần phòng"
  → the patrol officer (a distinct speaker). If truly unknown, use "Unknown" —
  never collapse everything onto one name.
- "dialogue" holds ONLY words spoken ALOUD. Crowd/action beats, sound cues, and
  inner thoughts ("trong lòng nghĩ/mắng thầm", "thầm nghĩ", "tự nhủ") are NOT
  dialogue → move them to "narration". Do NOT invent a "Narrator" character.
- Choose "emotion" from the listed set (omit if unclear); "intensity" is optional.
- Known names — use EXACTLY these spellings:
  characters: {known_characters}
  locations: {known_locations}

The scene to re-extract currently looks like this (use it to locate the right
part of the chapter):
{anchor}

Chapter text:
---
{chunk_text}
---"""


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

_SCENE_EXTRACT_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Extract ONE scene from the scene text below. Return ONLY one JSON object (NOT an
array, no markdown), keeping the given "scene_id":

{{
  "scene_id": "{scene_id}",
  "location": "string",
  "characters": ["string"],
  "shot_type": "wide | medium | close-up | insert | POV",
  "action": "string",
  "dialogue": [
    {{"character": "string", "line": "string", "emotion": "one of: {emotions}", "intensity": "one of: {intensities}"}}
  ],
  "narration": ["string"],
  "mood": "string"
}}

Rules:
- SPEAKER ATTRIBUTION is the priority: use speech tags (before OR after the
  quote: "X nói/đáp/mắng/quát/hét/lạnh giọng"); speakers ALTERNATE in an
  exchange; a reply to an accusation is the OTHER party. Resolve epithets
  ("bản quan / ngự sử / lão già" -> the censor; "tiểu công gia / thiếu gia" ->
  the young noble; "giáo úy / tuần phòng" -> the patrol officer). If a speaker
  is unidentifiable use "Unknown" — never collapse everyone onto one name.
- "dialogue" = ONLY words spoken ALOUD. Crowd/action beats, sound cues, and
  inner thoughts ("trong lòng nghĩ/mắng thầm", "thầm nghĩ", "tự nhủ") go in
  "narration", never as a spoken line.
- Choose "emotion" from the listed set (omit if unclear); "intensity" optional.
- Hint for this scene — location: {hint_location}; characters: {hint_characters}.
- Known names — use EXACTLY these spellings:
  characters: {known_characters}
  locations: {known_locations}

Scene text:
---
{scene_text}
---"""

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
        scene = await _call_qwen(prompt, label=scene_id, **qwen)
    except ValueError:
        logger.warning("[two_phase] scene %s extraction failed; skipping", scene_id)
        return None
    # Tolerate a model that wraps the object in {"scenes": [...]}.
    if isinstance(scene, dict) and isinstance(scene.get("scenes"), list) and scene["scenes"]:
        scene = scene["scenes"][0]
    if not isinstance(scene, dict):
        return None
    scene["scene_id"] = scene_id
    return scene


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
        # Single-pass (default, and fallback if segmentation yields nothing).
        scenes_data = await _call_qwen(_main_prompt(chunk_id, chunk_text, known), label=chunk_id, **qwen)
        raw_scenes = scenes_data.get("scenes", [])

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
        scene = data[0] if data else {}
    elif isinstance(data, dict) and isinstance(data.get("scenes"), list):
        scene = data["scenes"][0] if data["scenes"] else {}
    else:
        scene = data

    scene = dict(scene)
    scene["scene_id"] = scene_id  # always keep the requested id
    return registry.normalize_scene(scene)


ProgressFn = Callable[[int, int, str], Awaitable[None]]


async def parse_episode(
    episode_id: str,
    episode_dir: Path,
    chunk_ids: list[str] | None = None,
    qwen_endpoint: str | None = None,
    on_progress: ProgressFn | None = None,
) -> list[Path]:
    """Parse all (or selected) chunks in episode_dir. Returns list of written paths.

    If ``on_progress`` is given it is awaited with ``(done, total, chunk_id)``:
    once at the start as ``(0, total, "")`` and after each chunk completes. This
    drives the live progress bar/logs in the UI (progress == chunks done / total).
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
    if on_progress is not None:
        await on_progress(0, total, "")

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

    logger.info("[parse_episode] episode=%s done: wrote %d file(s)", episode_id, len(results))
    return results
