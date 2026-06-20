# animatory/visual_inference.py
"""Layer 2′ — free genre inference (xianxia / donghua visual design).

The grounded ``description`` block (animatory/entity_enrichment.py) is deliberately
evidence-only: it never invents detail, and other phases trust it. This phase is the
opposite kind of synthesis. It reads that grounded description and produces a
COMPLETE donghua visual design per entity — inferring freely from the xianxia genre
and the character's role where the evidence is silent, but honoring the evidence
where it exists.

The result lands in a separate ``visual`` block (never in ``description``), where
every field carries ``{value, source}`` and ``source`` is ``"script"`` (grounded in
the evidence) or ``"inferred"`` (genre synthesis). Like enrichment, the pass is
best-effort per entity — one failure is logged and skipped, never aborting the run —
and merged fill-empty so manual edits survive re-runs.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path

from animatory.parsing import entity_registry as er

logger = logging.getLogger(__name__)

CallFn = Callable[..., Awaitable[dict]]


# ── helpers ──────────────────────────────────────────────────────────────────

def _coerce_str(v: object) -> str:
    return v.strip() if isinstance(v, str) else ""


def _default_call_fn() -> CallFn:
    # Lazy import keeps scene_parser free to import this module at function scope.
    from animatory.llm.qwen import _call_qwen
    return _call_qwen


def _render_grounded(desc: dict | None) -> str:
    """Compact ``field: value`` rendering of a grounded description, skipping empty
    fields. Lists (e.g. ``time_variants``) are comma-joined."""
    lines: list[str] = []
    for k, v in (desc or {}).items():
        if isinstance(v, list):
            v = ", ".join(s for s in (str(x).strip() for x in v) if s)
        if isinstance(v, str):
            v = v.strip()
        if v:
            lines.append(f"{k}: {v}")
    return "\n".join(lines)


def _coerce_visual(data: object, fields: tuple[str, ...]) -> dict:
    """Force Qwen output into ``{field: {value:str, source:"script"|"inferred"}}``
    for exactly *fields*, tolerating bare strings, missing/invalid ``source`` and
    unknown keys. An absent or empty field becomes a blank ``{value:"", source:""}``
    so it is treated as unfilled downstream."""
    src = data if isinstance(data, dict) else {}
    out: dict = {}
    for f in fields:
        raw = src.get(f)
        if isinstance(raw, dict):
            value = _coerce_str(raw.get("value"))
            source = raw.get("source")
        else:
            value = _coerce_str(raw)
            source = None
        if not value:
            out[f] = {"value": "", "source": ""}
        else:
            out[f] = {"value": value,
                      "source": source if source in ("script", "inferred") else "inferred"}
    return out


def _derive_role(entry: dict, max_lines: int) -> str:
    """Heuristic role used only to steer inference (a ``roles.json`` override wins)."""
    lc = (entry.get("voice") or {}).get("line_count", 0) or 0
    scenes = len(entry.get("appears_in") or [])
    if max_lines and lc >= max_lines:
        return "protagonist"
    if lc == 0 and scenes <= 1:
        return "background"
    if lc >= max(1, max_lines // 3):
        return "supporting / major"
    return "supporting / minor"


def _load_roles(episode_dir) -> dict:
    if episode_dir is None:
        return {}
    rp = Path(episode_dir) / "roles.json"
    if not rp.exists():
        return {}
    try:
        data = json.loads(rp.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


# ── prompts ──────────────────────────────────────────────────────────────────

_CHAR_VISUAL_PROMPT = """\
You are a character designer for a 2D Chinese donghua (xianxia / court-drama).
Given the grounded evidence about "{name}" and their role ({role}), produce a
COMPLETE visual design for image generation.

- Where the evidence states or implies a detail, USE it and mark "source":"script".
- Where the evidence is SILENT, INFER a genre-appropriate detail (hanfu, hairpins,
  phoenix / peach-blossom eyes, topknot + guan, embroidered daopao, jade pendants,
  qi aura, etc.) and mark "source":"inferred".
- Era / aesthetic: ancient Chinese xianxia / wuxia — NOT modern, NOT Japanese.
- Keep each value a short phrase. Return ONLY this JSON, no markdown:

{{
  "face":     {{"value": "...", "source": "script|inferred"}},
  "eyes":     {{"value": "...", "source": "script|inferred"}},
  "hair":     {{"value": "...", "source": "script|inferred"}},
  "attire":   {{"value": "...", "source": "script|inferred"}},
  "palette":  {{"value": "...", "source": "script|inferred"}},
  "build":    {{"value": "...", "source": "script|inferred"}},
  "props":    {{"value": "...", "source": "script|inferred"}},
  "aura_vfx": {{"value": "...", "source": "script|inferred"}}
}}

Grounded evidence about {name}:
---
{grounded}
---"""

_LOC_VISUAL_PROMPT = """\
You are a background-art director for a 2D Chinese donghua (xianxia / court-drama).
Given the grounded evidence about the LOCATION "{name}", produce a COMPLETE
background-art design for image generation.

- Where the evidence states or implies a detail, USE it and mark "source":"script".
- Where the evidence is SILENT, INFER a genre-appropriate detail (carved wood,
  upturned eaves, silk screens, lanterns, ink-wash mountains, jade floors, etc.)
  and mark "source":"inferred".
- Era / aesthetic: ancient Chinese xianxia / wuxia — NOT modern, NOT Japanese.
- Keep each value a short phrase. Return ONLY this JSON, no markdown:

{{
  "setting":      {{"value": "...", "source": "script|inferred"}},
  "architecture": {{"value": "...", "source": "script|inferred"}},
  "props":        {{"value": "...", "source": "script|inferred"}},
  "lighting":     {{"value": "...", "source": "script|inferred"}},
  "atmosphere":   {{"value": "...", "source": "script|inferred"}},
  "palette":      {{"value": "...", "source": "script|inferred"}},
  "time_of_day":  {{"value": "...", "source": "script|inferred"}}
}}

Grounded evidence about {name}:
---
{grounded}
---"""


# ── phase ────────────────────────────────────────────────────────────────────

async def infer_visuals(
    registry: er.EntityRegistry,
    *,
    call_fn: CallFn | None = None,
    qwen: dict | None = None,
    force: bool = False,
    episode_dir=None,
    on_entity: Callable[[str, dict], Awaitable[None]] | None = None,
) -> er.EntityRegistry:
    """Synthesize a ``visual`` block for every character and location on *registry*.

    Best-effort per entity (one failure is logged and skipped). Fill-empty merge so
    re-runs never clobber prior work unless ``force``. If ``on_entity`` is given it
    is awaited as ``(kind, entry)`` after each entity is merged. Returns the
    registry; the caller saves it."""
    call_fn = call_fn or _default_call_fn()
    qwen = qwen or {}
    roles = _load_roles(episode_dir)

    line_counts = [(c.get("voice") or {}).get("line_count", 0) or 0 for c in registry.characters]
    max_lines = max(line_counts) if line_counts else 0

    async def _emit(kind: str, entry: dict) -> None:
        if on_entity is not None:
            await on_entity(kind, entry)

    # Characters
    for entry in registry.characters:
        name = entry["canonical"]
        role = roles.get(name) or _derive_role(entry, max_lines)
        entry["role"] = role
        prompt = _CHAR_VISUAL_PROMPT.format(
            name=name, role=role, grounded=_render_grounded(entry.get("description")),
        )
        try:
            data = await call_fn(prompt, label=f"visual/char/{name}", **qwen)
        except Exception as exc:  # noqa: BLE001 — degrade gracefully per entity
            logger.warning("[visual] character %s failed: %r", name, exc)
            continue
        visual = _coerce_visual(data, er.CHAR_VISUAL_FIELDS)
        registry.merge_visual("characters", name, visual=visual, force=force)
        await _emit("characters", entry)

    # Locations
    for entry in registry.locations:
        name = entry["canonical"]
        prompt = _LOC_VISUAL_PROMPT.format(
            name=name, grounded=_render_grounded(entry.get("description")),
        )
        try:
            data = await call_fn(prompt, label=f"visual/loc/{name}", **qwen)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[visual] location %s failed: %r", name, exc)
            continue
        visual = _coerce_visual(data, er.LOC_VISUAL_FIELDS)
        registry.merge_visual("locations", name, visual=visual, force=force)
        await _emit("locations", entry)

    return registry
