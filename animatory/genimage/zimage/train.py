"""Stage-1 LoRA training for **hero characters** — a thin Ostris AI Toolkit wrapper.

Per spec §6 this is a *documented manual step*, not a from-scratch trainer. The reusable
value is the ``rig.json`` contract: once a LoRA exists, ``train.py`` copies it into the rig
folder and flips ``trained: true`` so the engine attaches it and the runner prompts with the
trigger. Until then the character rig falls back to reference + locked seed automatically
(``Rig.uses_lora`` is False), so the pipeline already runs end-to-end without training.

This module shells out to the toolkit; it has no torch import of its own. On a box without
the toolkit, ``train_character_lora(..., run=True)`` raises a clear error and the recipe is
available via ``print_recipe``.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from animatory.genimage.zimage.rig import Rig

logger = logging.getLogger(__name__)

# 8GB low-VRAM profile (spec §6): 512px, rank 8, batch 1, grad checkpointing.
RECIPE = """\
Ostris AI Toolkit — hero character LoRA (8GB profile)
  inputs : rigs/character/<name>/refs/   (8-12 imgs, <=768px, 2D toon)
  config : 512px · rank 8 · batch 1 · grad-checkpointing · low-VRAM
  steps  : ~2500 · adapter v1
  output : copy resulting lora.safetensors into the rig folder; set rig.json trained=true
"""


def print_recipe() -> str:
    print(RECIPE)
    return RECIPE


def _slug(name: str) -> str:
    return "_".join(name.strip().lower().split())


def mark_trained(name: str, lora_src: str | Path, *, rigs_dir: str | Path = "rigs",
                 strength: float = 0.9, train_notes: str = "") -> Path:
    """Install a finished LoRA into the character rig and flip ``trained: true``.

    Use this after running the toolkit manually. Copies ``lora_src`` to
    ``rigs/character/<name>/lora.safetensors`` and rewrites ``rig.json``.
    """
    rig_dir = Path(rigs_dir) / "character" / _slug(name)
    rig_path = rig_dir / "rig.json"
    if not rig_path.exists():
        raise FileNotFoundError(f"no rig.json for character '{name}' at {rig_path} — build the rig first")

    dest = rig_dir / "lora.safetensors"
    shutil.copyfile(lora_src, dest)

    rig = Rig.load(rig_path)
    rig.identity_mode = "lora"
    rig.lora_path = str(dest)
    rig.lora_strength = strength
    rig.trained = True
    if train_notes:
        rig.train_notes = train_notes
    rig.save(rig_path)
    logger.info("rig '%s' now LoRA-trained (%s)", name, dest)
    return rig_path


def train_character_lora(name: str, refs_dir: str | Path, *, rigs_dir: str | Path = "rigs",
                         run: bool = False) -> Path | None:
    """Assemble + (optionally) run the Ostris training for one hero character.

    ``run=False`` (default) prints the manual recipe and returns None — the safe MVP path.
    ``run=True`` requires the toolkit on PATH; raises if absent.
    """
    refs = Path(refs_dir)
    if not refs.exists():
        raise FileNotFoundError(f"reference images not found: {refs}")
    if not run:
        print_recipe()
        logger.info("dry run for '%s' — pass run=True with the Ostris toolkit installed to train", name)
        return None

    if shutil.which("ai-toolkit") is None:  # pragma: no cover - environment-dependent
        raise RuntimeError(
            "Ostris AI Toolkit not found on PATH. Install it and run manually per print_recipe(), "
            "then call mark_trained() to install the LoRA into the rig."
        )
    # pragma: no cover below — real training only runs on the GPU box.
    rig_dir = Path(rigs_dir) / "character" / _slug(name)  # pragma: no cover
    subprocess.run(["ai-toolkit", "run", "--input", str(refs), "--output", str(rig_dir)], check=True)  # pragma: no cover
    return mark_trained(name, rig_dir / "lora.safetensors", rigs_dir=rigs_dir, train_notes="ostris v1, r=8, 512px")  # pragma: no cover
