# animatory/entity_enrichment.py
"""Episode-scoped enrichment phases that run after scene parsing.

The scene parser lifts verbatim text via anchored beats (corruption-proof). A
*description* is the opposite kind of data: a synthesis across every appearance
of an entity, grounded in — but not a verbatim slice of — the source. These
phases run once per episode, after all chunks are parsed, in order:

    Locations  → structured background description per location
    Characters → structured reference-sheet description per character
    Voices     → per-character voice profile (LLM register/tone/pace + stats)
    Scenes     → one grounded one-line ``summary`` per scene

All synthesis is evidence-only (the prompts forbid inventing detail the snippets
don't support) and merged fill-empty so manual edits survive re-parsing.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from animatory.parsing import entity_registry as er
from animatory.enrichment.voice_profiles import aggregate

logger = logging.getLogger(__name__)

# Bound prompt size: enough context to describe an entity, never the whole episode.
EVIDENCE_BUDGET = 1600       # max chars of evidence per entity
ACTION_EXCERPT = 240         # max chars of action quoted per scene in the summary pass

CallFn = Callable[..., Awaitable[dict]]


# ── helpers ──────────────────────────────────────────────────────────────────

def _coerce_str(v: object) -> str:
    return v.strip() if isinstance(v, str) else ""


def _coerce_str_list(v: object) -> list[str]:
    if not isinstance(v, list):
        return []
    return [s.strip() for s in v if isinstance(s, str) and s.strip()]


def _clip(text: str, budget: int) -> str:
    text = text.strip()
    return text if len(text) <= budget else text[:budget].rstrip() + " …"


def _default_call_fn() -> CallFn:
    # Qwen client now lives in animatory.llm.qwen — no dependency on scene_parser,
    # so the old scene_parser <-> entity_enrichment import cycle is gone.
    from animatory.llm.qwen import _call_qwen
    return _call_qwen


# ── appearance index ─────────────────────────────────────────────────────────

def build_appearance_index(scenes: list[dict]) -> dict[str, list[dict]]:
    """Map each character / location to the scenes it appears in plus a bounded
    bundle of evidence snippets lifted from those scenes.

    Returns ``{"characters": [entry, ...], "locations": [entry, ...]}`` where each
    entry is ``{name, key, appears_in: [scene_id], evidence: str}``. Names are
    assumed already canonical (scenes are normalized before this runs); variants
    are de-duplicated by match key, first-seen order preserved.
    """
    chars: dict[str, dict] = {}
    locs: dict[str, dict] = {}

    def _bucket(store: dict, name: str) -> dict | None:
        if not isinstance(name, str) or not name.strip() or name == "Unknown":
            return None
        k = er._key(name)
        if k not in store:
            store[k] = {"name": name.strip(), "key": k, "appears_in": [], "_evidence": []}
        return store[k]

    for s in scenes:
        sid = s.get("scene_id") or ""
        action = _coerce_str(s.get("action"))
        narration = " ".join(_coerce_str_list(s.get("narration")))
        mood = _coerce_str(s.get("mood"))
        dialogue = [d for d in (s.get("dialogue") or []) if isinstance(d, dict)]

        # Location evidence: what the scene shows (action, narration, mood).
        loc = _bucket(locs, s.get("location"))
        if loc is not None:
            if sid and sid not in loc["appears_in"]:
                loc["appears_in"].append(sid)
            parts = [p for p in (action, narration, (f"mood: {mood}" if mood else "")) if p]
            if parts:
                loc["_evidence"].append(" ".join(parts))

        # Character evidence: roster + speakers; include the character's own lines.
        names = set(s.get("characters") or [])
        names |= {d.get("character") for d in dialogue if d.get("character")}
        for name in names:
            c = _bucket(chars, name)
            if c is None:
                continue
            if sid and sid not in c["appears_in"]:
                c["appears_in"].append(sid)
            lines = [
                _coerce_str(d.get("line"))
                for d in dialogue
                if d.get("character") == name and _coerce_str(d.get("line"))
            ]
            snippet_parts = []
            if action:
                snippet_parts.append(action)
            if lines:
                snippet_parts.append(f"{name}: " + " / ".join(lines))
            if snippet_parts:
                c["_evidence"].append(" ".join(snippet_parts))

    def _finish(store: dict) -> list[dict]:
        out = []
        for e in store.values():
            evidence = _clip("\n".join(e.pop("_evidence")), EVIDENCE_BUDGET)
            out.append({**e, "evidence": evidence})
        return out

    return {"characters": _finish(chars), "locations": _finish(locs)}


# ── prompts ──────────────────────────────────────────────────────────────────

_LOCATION_PROMPT = """\
You are a background-art director for a 2D animation of a Vietnamese novel.
Describe the LOCATION "{name}" for background painting, using ONLY the evidence
snippets below. Return ONLY a JSON object — no markdown:

{{
  "summary": "<one short sentence, or empty>",
  "setting": "<architecture / furnishings / surroundings, or empty>",
  "lighting": "<lighting, atmosphere or mood, or empty>",
  "time_variants": ["day" | "night" | "sunset" | "dawn" ...]
}}

Rules:
- Use ONLY what the snippets state or clearly imply. If the text does not support
  a field, return "" (or [] for time_variants). NEVER invent architecture, props,
  colors, or times of day not present in the evidence.
- Keep each field short — a phrase, not prose. Vietnamese or English is fine.

Evidence (scenes set in {name}):
---
{evidence}
---"""

_CHARACTER_PROMPT = """\
You are a character designer for a 2D animation of a Vietnamese novel.
Describe the CHARACTER "{name}" for a reference sheet and give a voice profile,
using ONLY the evidence snippets below. Return ONLY a JSON object — no markdown:

{{
  "description": {{
    "summary": "<one short sentence, or empty>",
    "appearance": "<face, hair, distinguishing features, or empty>",
    "attire": "<clothing / accessories, or empty>",
    "age_build": "<apparent age and build, or empty>",
    "palette": "<dominant colors associated with them, or empty>"
  }},
  "voice": {{
    "register": "<pitch / register, e.g. low baritone, or empty>",
    "tone": "<habitual tone, e.g. sardonic, warm, or empty>",
    "pace": "<speaking pace, e.g. clipped, languid, or empty>"
  }}
}}

Rules:
- Use ONLY what the snippets state or clearly imply. If the text does not support
  a field, return "". NEVER invent appearance, clothing, colors, or vocal traits
  not present in the evidence.
- Keep each field short. Vietnamese or English is fine.

Evidence (scenes featuring {name}, including their dialogue):
---
{evidence}
---"""

_SCENE_SUMMARY_PROMPT = """\
You are a storyboard assistant. For EACH scene below, write ONE short sentence
describing what we SEE (a storyboard caption), grounded ONLY in its action and
narration. Do NOT invent action that is not described.

Return ONLY a JSON object mapping scene_id to its summary string — no markdown:
{{ "{first_id}": "...", ... }}

Scenes:
{block}"""


# ── enrichment phases ────────────────────────────────────────────────────────

async def enrich_entities(
    registry: er.EntityRegistry,
    scenes: list[dict],
    *,
    call_fn: CallFn | None = None,
    qwen: dict | None = None,
    force: bool = False,
    on_entity: Callable[[str, dict], Awaitable[None]] | None = None,
) -> er.EntityRegistry:
    """Locations → Characters → Voices. Fills structured description + voice
    blocks on the registry, grounded in scene evidence. One bad entity is logged
    and skipped — it never aborts the pass.

    If ``on_entity`` is given it is awaited as ``(kind, entry)`` after each entity
    is merged (``kind`` is ``"locations"`` or ``"characters"``, ``entry`` is the
    merged registry dict) — used to stream descriptions to the UI as they land."""
    call_fn = call_fn or _default_call_fn()
    qwen = qwen or {}
    index = build_appearance_index(scenes)
    voice_stats = {er._key(p["character"]): p for p in aggregate(scenes)}

    async def _emit(kind: str, name: str) -> None:
        if on_entity is None:
            return
        entry = registry._find(kind, name)
        if entry is not None:
            await on_entity(kind, entry)

    # Phase: Locations
    for loc in index["locations"]:
        if not loc["evidence"]:
            registry.merge_descriptions("locations", loc["name"], appears_in=loc["appears_in"])
            await _emit("locations", loc["name"])
            continue
        prompt = _LOCATION_PROMPT.format(name=loc["name"], evidence=loc["evidence"])
        try:
            data = await call_fn(prompt, label=f"enrich/loc/{loc['name']}", **qwen)
        except Exception as exc:  # noqa: BLE001 — degrade gracefully per entity
            logger.warning("[enrich] location %s failed: %r", loc["name"], exc)
            registry.merge_descriptions("locations", loc["name"], appears_in=loc["appears_in"])
            await _emit("locations", loc["name"])
            continue
        description = {
            "summary": _coerce_str(data.get("summary")),
            "setting": _coerce_str(data.get("setting")),
            "lighting": _coerce_str(data.get("lighting")),
            "time_variants": _coerce_str_list(data.get("time_variants")),
        }
        registry.merge_descriptions(
            "locations", loc["name"], description=description,
            appears_in=loc["appears_in"], force=force,
        )
        await _emit("locations", loc["name"])

    # Phase: Characters (+ Voices)
    for ch in index["characters"]:
        stats = voice_stats.get(ch["key"], {})
        voice_stat_block = {
            "dominant_emotion": stats.get("dominant_emotion") or "",
            "dominant_intensity": stats.get("dominant_intensity") or "",
            "line_count": stats.get("line_count") or 0,
        }
        if not ch["evidence"]:
            registry.merge_descriptions(
                "characters", ch["name"], voice=voice_stat_block, appears_in=ch["appears_in"],
            )
            await _emit("characters", ch["name"])
            continue
        prompt = _CHARACTER_PROMPT.format(name=ch["name"], evidence=ch["evidence"])
        try:
            data = await call_fn(prompt, label=f"enrich/char/{ch['name']}", **qwen)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[enrich] character %s failed: %r", ch["name"], exc)
            registry.merge_descriptions(
                "characters", ch["name"], voice=voice_stat_block, appears_in=ch["appears_in"],
            )
            await _emit("characters", ch["name"])
            continue
        d = data.get("description") if isinstance(data.get("description"), dict) else {}
        v = data.get("voice") if isinstance(data.get("voice"), dict) else {}
        description = {
            "summary": _coerce_str(d.get("summary")),
            "appearance": _coerce_str(d.get("appearance")),
            "attire": _coerce_str(d.get("attire")),
            "age_build": _coerce_str(d.get("age_build")),
            "palette": _coerce_str(d.get("palette")),
        }
        voice = {
            "register": _coerce_str(v.get("register")),
            "tone": _coerce_str(v.get("tone")),
            "pace": _coerce_str(v.get("pace")),
            **voice_stat_block,
        }
        registry.merge_descriptions(
            "characters", ch["name"], description=description, voice=voice,
            appears_in=ch["appears_in"], force=force,
        )
        await _emit("characters", ch["name"])

    return registry


async def describe_scenes(
    scenes: list[dict],
    *,
    call_fn: CallFn | None = None,
    qwen: dict | None = None,
) -> dict[str, str]:
    """Phase: descriptive Scenes. Return ``{scene_id: summary}`` for the given
    scenes (one chunk's worth), grounded in each scene's action/narration. Returns
    ``{}`` on failure — summaries are additive, never load-bearing."""
    call_fn = call_fn or _default_call_fn()
    qwen = qwen or {}
    usable = [s for s in scenes if s.get("scene_id")]
    if not usable:
        return {}

    lines = []
    for s in usable:
        action = _clip(_coerce_str(s.get("action")), ACTION_EXCERPT)
        narration = _clip(" ".join(_coerce_str_list(s.get("narration"))), ACTION_EXCERPT)
        chars = ", ".join(_coerce_str_list(s.get("characters"))) or "?"
        lines.append(
            f"[{s['scene_id']}] location={_coerce_str(s.get('location')) or '?'}; "
            f"characters={chars}; action={action or '(none)'}; narration={narration or '(none)'}"
        )
    prompt = _SCENE_SUMMARY_PROMPT.format(first_id=usable[0]["scene_id"], block="\n".join(lines))
    try:
        data = await call_fn(prompt, label="enrich/scene-summaries", **qwen)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[enrich] scene summaries failed: %r", exc)
        return {}
    valid = {s["scene_id"] for s in usable}
    return {
        sid: _coerce_str(text)
        for sid, text in (data.items() if isinstance(data, dict) else [])
        if sid in valid and _coerce_str(text)
    }
