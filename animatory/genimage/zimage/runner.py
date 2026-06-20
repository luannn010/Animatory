"""The batch loop: shots + rigs + engine → panel PNG + reproducibility sidecar.

Shots are sorted by their driving rig so LoRA is swapped at most once per rig boundary
(spec acceptance #4). The engine is **injected**, so the loop is unit-testable with a fake
engine (no torch/GPU). Each panel gets a sidecar JSON — the reproduction guarantee from the
spec (§5): same rig + sidecar ⇒ same frame.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from animatory.genimage.zimage.rig import Rig
from animatory.genimage.zimage.shots import Shot, index_rigs, primary_rig, resolve_gen

logger = logging.getLogger(__name__)


@dataclass
class BatchResult:
    batch_id: str
    sidecars: list[dict] = field(default_factory=list)
    lora_swaps: int = 0


def _group_key(shot: Shot, rig_index) -> str:
    r = primary_rig(shot, rig_index)
    return r.name if r is not None else "~unrigged"


def run_batch(shots: list[Shot], rigs: list[Rig], engine, *, out_dir, batch_id: str,
              save: bool = True) -> BatchResult:
    rig_index = index_rigs(rigs)
    ordered = sorted(shots, key=lambda s: _group_key(s, rig_index))  # minimize LoRA swaps

    batch_dir = Path(out_dir) / batch_id
    if save:
        batch_dir.mkdir(parents=True, exist_ok=True)

    result = BatchResult(batch_id=batch_id)
    current_lora: str | None = None  # the LoRA path currently attached (None = base only)

    for shot in ordered:
        driver, prompt, seed, gk = resolve_gen(shot, rig_index)

        # Identity application — swap only when the target changes (acceptance #4).
        target_lora = driver.lora_path if (driver is not None and driver.uses_lora) else None
        if target_lora != current_lora:
            if target_lora is not None:
                engine.attach_lora(target_lora, driver.lora_strength)
            else:
                engine.unload_lora()
            current_lora = target_lora
            if target_lora is not None:
                result.lora_swaps += 1

        image, (eff_w, eff_h) = engine.generate(
            prompt, seed, width=gk["width"], height=gk["height"], negative=gk.get("negative", ""),
        )

        png_path = batch_dir / f"panel_{shot.id}.png"
        if save and image is not None and hasattr(image, "save"):
            image.save(png_path)

        sidecar = {
            "id": shot.id,
            "rig": driver.name if driver is not None else None,
            "trigger": driver.trigger if (driver is not None and driver.uses_lora) else None,
            "prompt": prompt,
            "seed": seed,
            "effective_w": eff_w,
            "effective_h": eff_h,
            "steps": gk["steps"],
            "lora_strength": driver.lora_strength if (driver is not None and driver.uses_lora) else None,
            "model": getattr(getattr(engine, "config", None), "model", None),
            "png": str(png_path),
        }
        if save:
            (batch_dir / f"panel_{shot.id}.json").write_text(
                json.dumps(sidecar, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        result.sidecars.append(sidecar)

    return result
