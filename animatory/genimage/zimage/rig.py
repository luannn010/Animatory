"""The generalized rig contract.

A **rig** is the durable artifact of stage 1 — the single source of identity + style that
every shot reuses, so per-shot prompts stay tiny. The spec's ``rig.json`` is character-
centric; here it is generalized with a ``kind`` field so the *same* contract covers
characters, locations (backgrounds), and recurring items (props). Only ``style_defaults``
differs by kind; the identity strategy is per-rig (LoRA for hero characters, reference +
locked seed for everything else).

This module is pure Python (no torch/diffusers) so the contract is testable without a GPU.
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass, field, fields
from pathlib import Path

KINDS = ("character", "location", "item")
IDENTITY_MODES = ("lora", "reference")

# Distilled-model invariants shared by every kind (Z-Image Turbo; see spec §3).
_INVARIANTS = {"steps": 9, "guidance_scale": 0.0, "scheduler": "FlowMatchEulerDiscrete"}

# Per-kind style defaults — the ONLY thing that varies by kind. Keeping the rest of the
# contract identical is what lets a single rig.json shape serve all three entity types.
KIND_STYLE_DEFAULTS: dict[str, dict] = {
    "character": {
        "style_tokens": "flat color 2D toon, clean lineart, character turnaround",
        "negative": "photorealistic, 3d render, blurry, deformed, extra limbs",
        "width": 512, "height": 768, **_INVARIANTS,
    },
    "location": {
        "style_tokens": "2D toon background painting, wide establishing, no characters",
        "negative": "photorealistic, 3d render, people, characters, text",
        "width": 768, "height": 512, **_INVARIANTS,
    },
    "item": {
        "style_tokens": "prop sheet, single object, isolated on neutral background",
        "negative": "photorealistic, 3d render, busy background, people, hands",
        "width": 512, "height": 512, **_INVARIANTS,
    },
}


@dataclass
class Rig:
    """Load/validate ``rig.json`` and assemble short prompts.

    ``identity_mode`` resolves the "both" strategy from the spec:
    - ``lora`` **and** ``trained`` → attach the LoRA, prompt with ``trigger``, seed is free.
    - otherwise → reference fallback: descriptive identity, **locked** ``fallback_seed``.
    """

    name: str
    kind: str
    identity_mode: str = "reference"
    lora_path: str | None = None
    lora_strength: float = 0.9
    trigger: str | None = None
    fallback_seed: int = 0
    fallback_refs: list[str] = field(default_factory=list)
    style_defaults: dict = field(default_factory=dict)
    trained: bool = False
    train_notes: str = ""
    appears_in: list[str] = field(default_factory=list)
    description: str = ""   # enriched appearance/attire text (from entity_enrichment)

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"rig '{self.name}': unknown kind '{self.kind}' (expected one of {KINDS})")
        if self.identity_mode not in IDENTITY_MODES:
            raise ValueError(
                f"rig '{self.name}': unknown identity_mode '{self.identity_mode}' (expected one of {IDENTITY_MODES})"
            )
        # Merge kind defaults under any per-rig overrides so style_defaults is always complete.
        merged = dict(KIND_STYLE_DEFAULTS.get(self.kind, {}))
        merged.update(self.style_defaults or {})
        self.style_defaults = merged

    # -- identity -----------------------------------------------------------------
    @property
    def uses_lora(self) -> bool:
        """True only when this rig can actually drive identity via a trained LoRA."""
        return self.identity_mode == "lora" and self.trained and bool(self.lora_path)

    def resolve_identity(self) -> dict:
        """How the engine should anchor identity for this rig (lora vs reference)."""
        if self.uses_lora:
            return {"mode": "lora", "lora_path": self.lora_path,
                    "strength": self.lora_strength, "trigger": self.trigger}
        return {"mode": "reference", "seed": self.fallback_seed, "refs": list(self.fallback_refs)}

    def resolve_seed(self, shot_seed: int | None = None) -> int:
        """Reference-mode seed is the identity anchor — it is **locked**.

        LoRA carries identity, so a per-shot seed is honored there. In reference mode a
        per-shot seed override is ignored (with a warning) per spec acceptance #5.
        """
        if self.uses_lora:
            return shot_seed if shot_seed is not None else self.fallback_seed
        if shot_seed is not None and shot_seed != self.fallback_seed:
            warnings.warn(
                f"rig '{self.name}' is reference-mode; ignoring per-shot seed {shot_seed} "
                f"(locked seed {self.fallback_seed} is the identity anchor)",
                stacklevel=2,
            )
        return self.fallback_seed

    # -- prompt -------------------------------------------------------------------
    def build_prompt(self, action: str = "") -> str:
        """Assemble a single-subject prompt: ``<identity>, <action>, <style_tokens>``.

        Identity is the LoRA trigger (lora mode) or the rig name (reference mode). Short
        by construction — only ``action`` is per-shot; identity + style come from the rig.
        Multi-entity composition (character + location + item in one frame) is handled in
        ``shots.compose_shot_prompt`` and is out of MVP scope here.
        """
        parts: list[str] = []
        if self.uses_lora and self.trigger:
            parts.append(self.trigger)
        else:
            parts.append(self.name)
        if action and action.strip():
            parts.append(action.strip())
        style = self.style_defaults.get("style_tokens")
        if style:
            parts.append(style)
        return ", ".join(parts)

    # -- gen kwargs ---------------------------------------------------------------
    def gen_kwargs(self) -> dict:
        """The fixed generation parameters the engine needs (size + distilled invariants)."""
        sd = self.style_defaults
        return {
            "width": sd.get("width", 512),
            "height": sd.get("height", 512),
            "steps": sd.get("steps", 9),
            "guidance_scale": sd.get("guidance_scale", 0.0),
            "scheduler": sd.get("scheduler", "FlowMatchEulerDiscrete"),
            "negative": sd.get("negative", ""),
        }

    # -- (de)serialize ------------------------------------------------------------
    @classmethod
    def from_dict(cls, data: dict) -> "Rig":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})

    @classmethod
    def load(cls, path: str | Path) -> "Rig":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "kind": self.kind,
            "identity_mode": self.identity_mode,
            "lora_path": self.lora_path,
            "lora_strength": self.lora_strength,
            "trigger": self.trigger,
            "fallback_seed": self.fallback_seed,
            "fallback_refs": list(self.fallback_refs),
            "style_defaults": self.style_defaults,
            "trained": self.trained,
            "train_notes": self.train_notes,
            "appears_in": list(self.appears_in),
            "description": self.description,
        }

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    @classmethod
    def new(cls, name: str, kind: str, *, identity_mode: str | None = None,
            fallback_seed: int = 0, appears_in: list[str] | None = None) -> "Rig":
        """Construct a rig with kind-appropriate defaults (reference mode unless told otherwise)."""
        return cls(
            name=name, kind=kind,
            identity_mode=identity_mode or "reference",
            trigger=(name.replace(" ", "").lower() + "char") if kind == "character" else None,
            fallback_seed=fallback_seed,
            appears_in=appears_in or [],
        )
