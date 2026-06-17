"""Asset-type presets + the "enhance" layer (BACKEND_SPEC.md §4, §5).

Callers send just ``asset_type`` + ``prompt`` and get a sensible result; presets fill anything
left ``None``. This module is intentionally dependency-free (no Pydantic/FastAPI) and operates
on any object exposing the request fields by attribute, so prompt building stays unit-testable.

These presets are the *direct image API* vocabulary (rig / background / shot). They are distinct
from the storyboard rig-pipeline's ``character`` / ``location`` / ``item`` kinds in
``animatory.zimage.rig`` — both vocabularies drive the same engine but serve different callers.

The ``background`` plate defaults to 1920x1080 per spec. On an 8GB card that resolution is
risky even with NF4 + model offload, so the size is env-overridable
(``IMAGEGEN_BG_WIDTH`` / ``IMAGEGEN_BG_HEIGHT``); the worker turns an OOM into clear guidance.
"""

from __future__ import annotations

import os
from enum import Enum


class AssetType(str, Enum):
    RIG = "rig"               # character — portrait, consistency matters
    BACKGROUND = "background"  # oversized stable plate, no characters
    SHOT = "shot"             # free-form composed shot


def _bg_size() -> tuple[int, int]:
    return (
        int(os.environ.get("IMAGEGEN_BG_WIDTH", "1920")),
        int(os.environ.get("IMAGEGEN_BG_HEIGHT", "1080")),
    )


# The shared render-style "spine" applied to EVERY asset type, so a rig, a background, and a
# shot of the same world all look like the same 2D production. Only composition differs per
# type (below). Without this, weak per-type style cues let Z-Image (which defaults to
# photorealism) drift — e.g. a flat-toon rig but a realistic shot.
STYLE_SPINE = (
    "flat 2D toon cartoon style, cel shading, clean bold line art, flat colors, "
    "anime / manhua aesthetic, "
)
# Pushed into every negative so realism is actively excluded (the missing piece before).
STYLE_NEGATIVE = "photorealistic, realistic, 3d render, photograph, cinematic photo, hyperrealistic"

# Per-spec §4. style_prefix now carries only the *composition* intent for the asset type;
# STYLE_SPINE supplies the art style. negative_base is the floor the caller's negatives are
# appended to (never replaced); STYLE_NEGATIVE is appended to all of them in build_prompts.
PRESETS: dict[AssetType, dict] = {
    AssetType.RIG: {
        "width": 768, "height": 1152, "steps": 8, "cfg_scale": 1.8,
        "style_prefix": "full body character design, single character, ",
        "negative_base": (
            "blurry, deformed hands, extra limbs, extra fingers, "
            "cropped, low detail, watermark, text, signature"
        ),
    },
    AssetType.BACKGROUND: {
        # width/height filled lazily from env in apply_defaults (large-plate intent, spec §4).
        "width": None, "height": None, "steps": 10, "cfg_scale": 1.5,
        "style_prefix": (
            "wide establishing background art, detailed environment, no characters, "
        ),
        "negative_base": (
            "people, characters, humans, foreground figures, "
            "blurry, low detail, watermark, text, frame, border"
        ),
    },
    AssetType.SHOT: {
        "width": 1280, "height": 720, "steps": 8, "cfg_scale": 1.5,
        "style_prefix": "scene composition, ",
        "negative_base": "blurry, low detail, watermark, text",
    },
}

# Numeric knobs the caller may override; preset fills only where the caller left None.
_NUMERIC_FIELDS = ("width", "height", "steps", "cfg_scale")


def _asset_type(req) -> AssetType:
    at = req.asset_type
    return at if isinstance(at, AssetType) else AssetType(at)


def apply_defaults(req) -> dict:
    """Return ``{width, height, steps, cfg_scale}`` merged caller→preset (fill only ``None``).

    Does not mutate ``req``. For ``background`` the preset size comes from env (see ``_bg_size``).
    """
    at = _asset_type(req)
    preset = dict(PRESETS[at])
    if at is AssetType.BACKGROUND and preset.get("width") is None:
        preset["width"], preset["height"] = _bg_size()

    resolved: dict = {}
    for field in _NUMERIC_FIELDS:
        caller_val = getattr(req, field, None)
        resolved[field] = caller_val if caller_val is not None else preset[field]
    return resolved


def build_prompts(req) -> tuple[str, str]:
    """Return ``(positive, negative)``.

    The caller's ``negative_prompt`` is **appended** to the preset base, never replacing it
    (spec §5). The preset ``style_prefix`` is prepended to the caller's positive prompt.
    """
    preset = PRESETS[_asset_type(req)]
    # STYLE_SPINE first so the art style is identical across asset types; then the per-type
    # composition prefix; then the caller's subject.
    positive = f"{STYLE_SPINE}{preset['style_prefix']}{req.prompt}"
    negatives = [preset["negative_base"], STYLE_NEGATIVE]
    caller_neg = (getattr(req, "negative_prompt", "") or "").strip()
    if caller_neg:
        negatives.append(caller_neg)
    return positive, ", ".join(negatives)
