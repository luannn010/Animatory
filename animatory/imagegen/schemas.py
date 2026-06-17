"""Pydantic request/response models for the imagegen API (BACKEND_SPEC.md §3, §9).

Kept separate from ``presets`` so the pure preset/prompt logic stays importable without
pulling FastAPI/Pydantic concerns into tests that only exercise prompt building.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from animatory.imagegen.presets import AssetType


class LoraConfig(BaseModel):
    """A named LoRA + its blend weight. Multiple are stackable (spec §6)."""

    name: str
    weight: float = 0.8


class GenerationRequest(BaseModel):
    """The body of ``POST /imagegen/generate`` (spec §3).

    Anything left ``None`` is filled from the asset-type preset (``apply_defaults``).
    """

    asset_type: AssetType
    prompt: str
    negative_prompt: str = ""
    loras: list[LoraConfig] = Field(default_factory=list)
    width: int | None = None
    height: int | None = None
    steps: int | None = None
    cfg_scale: float | None = None
    seed: int | None = None
    scene_id: str | None = None      # backgrounds belong to a scene
    character_id: str | None = None  # rigs belong to a character


class GenerateResponse(BaseModel):
    """202 response from ``POST /imagegen/generate``."""

    job_id: str
    status: str = "queued"


class JobView(BaseModel):
    """``GET /imagegen/jobs/{id}`` (spec §9)."""

    job_id: str
    status: str  # queued | running | done | error
    asset_type: str | None = None
    image_url: str | None = None
    seed: int | None = None
    meta: dict = Field(default_factory=dict)
    error: str | None = None
    created_at: str | None = None


class AssetItem(BaseModel):
    """One previously generated asset, for ``GET /imagegen/assets`` galleries (spec §9)."""

    job_id: str
    asset_type: str
    image_url: str | None = None
    seed: int | None = None
    character_id: str | None = None
    scene_id: str | None = None
    created_at: str | None = None


class HealthView(BaseModel):
    """``GET /imagegen/healthz`` (spec §13 acceptance 10)."""

    ok: bool
    free_vram_mb: int | None = None
    engine_loaded: bool = False


class TrainRequest(BaseModel):
    """Body of ``POST /imagegen/loras/train``.

    Trains a character LoRA from the rig's refs folder. ``refs_dir`` defaults to
    ``rigs/character/<slug(name)>/refs`` (resolved server-side).
    """

    name: str
    trigger: str | None = None
    caption: str | None = None
    refs_dir: str | None = None
    steps: int = 1500
    rank: int = 8
    lr: float = 1e-4
    resolution: int = 512
    strength: float = 0.9


class TrainResponse(BaseModel):
    """202 response from ``POST /imagegen/loras/train``."""

    job_id: str
    status: str = "queued"


class TrainJobView(BaseModel):
    """``GET /imagegen/trainings/{job_id}`` — training progress."""

    job_id: str
    status: str  # queued | running | done | error
    name: str | None = None
    step: int | None = None
    total: int | None = None
    loss: float | None = None
    lora_name: str | None = None
    error: str | None = None
    created_at: str | None = None
