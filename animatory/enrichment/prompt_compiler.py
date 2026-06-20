# animatory/prompt_compiler.py
"""Layer 3 — prompt compiler.

Flattens the free-inference ``visual`` block (animatory/visual_inference.py) into
flowing Z-Image Turbo prompt strings and writes ``character_prompts.json`` +
``location_prompts.json``. Pure functions + file writers — no LLM calls.

Z-Image Turbo prefers ONE flowing natural-language prompt, not weighted tags. Each
prompt is built as ``STYLE_GLOBAL → subject → ordered visual details``, dropping
empty fields and de-duplicating repeated phrases so there are never doubled ``, ,``
separators.
"""
from __future__ import annotations

import json
from pathlib import Path

from animatory.parsing import entity_registry as er

STYLE_GLOBAL = (
    "2D Chinese donghua, cel-shaded anime style, clean lineart, "
    "soft cinematic lighting, traditional Chinese xianxia aesthetic, "
    "ink-wash background accents, highly detailed, sharp focus"
)
CHAR_NEGATIVE = (
    "3d, photorealistic, western cartoon, japanese anime, modern clothing, "
    "deformed hands, extra fingers, mutated, blurry, lowres, text, watermark, signature"
)
LOC_NEGATIVE = (
    "3d, photorealistic, people, characters, modern buildings, cars, "
    "blurry, lowres, text, watermark, signature"
)

# Detail order (subject first, then these). ``build`` rides in the character subject.
_CHAR_DETAIL_ORDER = ("eyes", "face", "hair", "attire", "props", "aura_vfx", "palette")
_LOC_DETAIL_ORDER = (
    "setting", "architecture", "props", "lighting", "atmosphere", "palette", "time_of_day",
)


def _value(visual: dict, field: str) -> str:
    return ((visual.get(field) or {}).get("value") or "").strip()


def _compose(parts: list[str]) -> str:
    """Prefix STYLE_GLOBAL, drop empties, de-dupe (case-insensitive), comma-join."""
    seen: set[str] = set()
    cleaned: list[str] = []
    for p in parts:
        p = (p or "").strip().strip(",").strip()
        if not p or p.lower() in seen:
            continue
        seen.add(p.lower())
        cleaned.append(p)
    return ", ".join([STYLE_GLOBAL] + cleaned)


def _provenance(visual: dict, fields: tuple[str, ...]) -> dict:
    out: dict = {}
    for f in fields:
        cell = visual.get(f) or {}
        if (cell.get("value") or "").strip() and cell.get("source") in ("script", "inferred"):
            out[f] = cell["source"]
    return out


def build_character_prompt(entry: dict) -> dict:
    """{name, role?, positive, negative, provenance} for one character."""
    visual = entry.get("visual") or {}
    canonical = entry.get("canonical", "")
    role = (entry.get("role") or "").strip()
    build = _value(visual, "build")

    subject_bits = ["a"]
    if build:
        subject_bits.append(build)
    if role:
        subject_bits.append(role)
    subject_bits += ["character named", canonical]
    subject = " ".join(b for b in subject_bits if b).strip()

    parts = [subject] + [_value(visual, f) for f in _CHAR_DETAIL_ORDER]
    out = {
        "name": canonical,
        "positive": _compose(parts),
        "negative": CHAR_NEGATIVE,
        "provenance": _provenance(visual, er.CHAR_VISUAL_FIELDS),
    }
    if role:
        out["role"] = role
    return out


def build_location_prompt(entry: dict) -> dict:
    """{name, positive, negative, provenance} for one location."""
    visual = entry.get("visual") or {}
    canonical = entry.get("canonical", "")
    parts = [canonical] + [_value(visual, f) for f in _LOC_DETAIL_ORDER]
    return {
        "name": canonical,
        "positive": _compose(parts),
        "negative": LOC_NEGATIVE,
        "provenance": _provenance(visual, er.LOC_VISUAL_FIELDS),
    }


def compile_episode(episode_id: str, episode_dir) -> tuple[Path, Path]:
    """Load ``entities.json`` and write both prompt files. Returns their paths."""
    episode_dir = Path(episode_dir)
    reg = er.load(episode_id, episode_dir)

    char_doc = {
        "episode_id": episode_id,
        "generator": "zimage-turbo",
        "style_global": STYLE_GLOBAL,
        "characters": [build_character_prompt(e) for e in reg.characters],
    }
    loc_doc = {
        "episode_id": episode_id,
        "generator": "zimage-turbo",
        "style_global": STYLE_GLOBAL,
        "locations": [build_location_prompt(e) for e in reg.locations],
    }

    char_path = episode_dir / "character_prompts.json"
    loc_path = episode_dir / "location_prompts.json"
    char_path.write_text(json.dumps(char_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    loc_path.write_text(json.dumps(loc_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return char_path, loc_path
