"""Z-Image pipeline configuration (paths, dtype, device, offload, model id).

All values are env-overridable so the same code runs on the 8GB GPU box and in CI (where
torch/diffusers are absent and only the pure-Python layers are exercised).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    return os.environ.get(name, "1" if default else "0") == "1"


@dataclass
class ZImageConfig:
    model: str = os.environ.get("ZIMAGE_MODEL", "Tongyi-MAI/Z-Image-Turbo")
    dtype: str = os.environ.get("ZIMAGE_DTYPE", "bfloat16")
    device: str = os.environ.get("ZIMAGE_DEVICE", "cuda")
    cpu_offload: bool = _env_bool("ZIMAGE_CPU_OFFLOAD", True)   # required for 8GB (spec §3)
    # 8GB reality: the 6B DiT in bf16 (~12GB) exceeds the whole card, so the transformer
    # must be quantized ("bnb4" = bitsandbytes NF4, the fp8-class profile the spec assumes)
    # or offloaded leaf-by-leaf ("sequential", slow). "none" = full bf16 (needs >12GB VRAM).
    quant: str = os.environ.get("ZIMAGE_QUANT", "bnb4")          # bnb4 | none
    offload_mode: str = os.environ.get("ZIMAGE_OFFLOAD", "model")  # model | sequential
    rigs_dir: Path = Path(os.environ.get("ZIMAGE_RIGS_DIR", "rigs"))
    out_dir: Path = Path(os.environ.get("ZIMAGE_OUT_DIR", "out"))
    # Distilled-model invariants — not per-shot knobs (spec §3).
    steps: int = int(os.environ.get("ZIMAGE_STEPS", "9"))
    guidance_scale: float = float(os.environ.get("ZIMAGE_GUIDANCE", "0.0"))
    scheduler: str = os.environ.get("ZIMAGE_SCHEDULER", "FlowMatchEulerDiscrete")
