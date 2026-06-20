"""Image-generation API surface (BACKEND_SPEC.md).

A thin layer over the existing Z-Image engine (``animatory.genimage.zimage.engine``) and the GPU/VRAM
arbiter (``animatory.genimage.zimage.brain``). It exposes the spec's ergonomic, asset-type-oriented HTTP
API (``POST /generate`` etc.) without standing up a second GPU-owning service — the single 8GB
card can only feed one consumer at a time, so the worker here shares the backend's engine and
serializes inference behind a process-level lock.

Public surface:
- ``AssetType``, ``PRESETS``, ``apply_defaults``, ``build_prompts`` (``presets``)
- ``LoraRegistry``, ``LoraNotFound`` (``lora``)
- ``ImageJobStore`` (``jobs``)
- ``run_job`` (``service``)
- ``router`` (``router``)
"""

from animatory.genimage.imagegen.presets import AssetType, PRESETS, apply_defaults, build_prompts
from animatory.genimage.imagegen.lora import LoraRegistry, LoraNotFound

__all__ = [
    "AssetType",
    "PRESETS",
    "apply_defaults",
    "build_prompts",
    "LoraRegistry",
    "LoraNotFound",
]
