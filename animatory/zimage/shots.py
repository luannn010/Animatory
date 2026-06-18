"""Adapt enriched-shot records into ``Shot`` objects and compose per-shot prompts.

A storyboard shot may reference several entities (a character, its scene's location, any
items present). Full multi-subject *composition* is out of MVP scope (spec §8); here we
build a single prompt that leads with the primary character's identity, sets the location
as background, and mentions items — the "driving" rig (character first, else location)
supplies size + the locked/free seed. Pure Python; no engine needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from animatory.parsing.entity_registry import _key
from animatory.zimage.rig import Rig


@dataclass
class Shot:
    id: str
    sceneId: str | None = None
    action: str = ""
    dialogue: str = ""
    characters: list[str] = field(default_factory=list)
    location: str | None = None       # from the shot's scene (scene.location)
    items: list[str] = field(default_factory=list)  # recurring items present in this shot
    seed: int | None = None

    @classmethod
    def from_enriched(cls, d: dict, *, location: str | None = None,
                      items: list[str] | None = None) -> "Shot":
        return cls(
            id=str(d.get("id", "")),
            sceneId=str(d["sceneId"]) if d.get("sceneId") is not None else None,
            action=(d.get("action") or ""),
            dialogue=(d.get("dialogue") or ""),
            characters=list(d.get("characters") or []),
            location=location,
            items=list(items or []),
            seed=d.get("seed"),
        )


def index_rigs(rigs: list[Rig]) -> dict[str, Rig]:
    """Map normalized entity name → Rig (so shot entity names resolve to rigs)."""
    return {_key(r.name): r for r in rigs}


def primary_rig(shot: Shot, rig_index: dict[str, Rig]) -> Rig | None:
    """The first character in the shot that has a character rig (drives identity)."""
    for c in shot.characters:
        r = rig_index.get(_key(c))
        if r is not None and r.kind == "character":
            return r
    return None


def location_rig(shot: Shot, rig_index: dict[str, Rig]) -> Rig | None:
    if not shot.location:
        return None
    r = rig_index.get(_key(shot.location))
    return r if (r is not None and r.kind == "location") else None


def validate_shot(shot: Shot, rig_index: dict[str, Rig]) -> list[str]:
    """Entity names referenced by the shot that have no rig yet (so callers can warn/build)."""
    missing: list[str] = []
    for c in shot.characters:
        if _key(c) not in rig_index:
            missing.append(c)
    if shot.location and _key(shot.location) not in rig_index:
        missing.append(shot.location)
    for it in shot.items:
        if _key(it) not in rig_index:
            missing.append(it)
    return missing


def compose_shot_prompt(shot: Shot, rig_index: dict[str, Rig]) -> str:
    """``<identity>, <action>, background: <location>, with <item>..., <style_tokens>``."""
    parts: list[str] = []

    char_rig = primary_rig(shot, rig_index)
    if char_rig is not None:
        parts.append(char_rig.trigger if (char_rig.uses_lora and char_rig.trigger) else char_rig.name)
    elif shot.characters:
        parts.append(shot.characters[0])

    if shot.action.strip():
        parts.append(shot.action.strip())
    elif shot.dialogue.strip():
        subj = shot.characters[0] if shot.characters else "the character"
        parts.append(f"{subj} speaking")

    loc_rig = location_rig(shot, rig_index)
    if loc_rig is not None:
        parts.append(f"background: {loc_rig.name}")
    elif shot.location:
        parts.append(f"background: {shot.location}")

    for it in shot.items:
        parts.append(f"with {it}")

    style_src = char_rig or loc_rig
    style = (style_src.style_defaults.get("style_tokens")
             if style_src is not None else "flat color 2D toon, clean lineart")
    if style:
        parts.append(style)

    return ", ".join(p for p in parts if p)


def resolve_gen(shot: Shot, rig_index: dict[str, Rig]):
    """Return ``(driver_rig|None, prompt, seed, gen_kwargs)`` for one shot.

    The driver is the primary character rig if present, else the location rig; it sets the
    output size and the seed policy (locked in reference mode, free in LoRA mode).
    """
    driver = primary_rig(shot, rig_index) or location_rig(shot, rig_index)
    prompt = compose_shot_prompt(shot, rig_index)
    if driver is not None:
        seed = driver.resolve_seed(shot.seed)
        gen_kwargs = driver.gen_kwargs()
    else:
        seed = shot.seed if shot.seed is not None else 0
        gen_kwargs = {"width": 512, "height": 768, "steps": 9, "guidance_scale": 0.0,
                      "scheduler": "FlowMatchEulerDiscrete", "negative": ""}
    return driver, prompt, seed, gen_kwargs
