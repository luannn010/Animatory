"""Pydantic models for the studio surface.

Field names are snake_case in Python but serialize to camelCase JSON via a
``to_camel`` alias generator, so the payloads match the frontend TypeScript
types in ``frontend/src/studio/types.ts`` exactly.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """Base: snake_case fields, camelCase JSON, accepts either on input."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ── enums ─────────────────────────────────────────────────────────────────────

class Phase(str, Enum):
    parse = "parse"
    pre = "pre"
    vendor = "vendor"
    post = "post"


class PhaseStatus(str, Enum):
    locked = "locked"
    active = "active"
    complete = "complete"


class AssetType(str, Enum):
    character = "character"
    prop = "prop"
    background = "background"
    fx = "fx"


class AssetStatus(str, Enum):
    rough = "rough"
    clean = "clean"
    color = "color"
    done = "done"


class VendorStage(str, Enum):
    rigs = "rigs"
    setup = "setup"
    block = "block"
    animate = "animate"
    take1 = "take1"
    editor = "editor"


class VendorStageStatus(str, Enum):
    pending = "pending"
    active = "active"
    done = "done"
    retake = "retake"


class PostStatus(str, Enum):
    done = "done"
    active = "active"
    pending = "pending"
    locked = "locked"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


# ── resources ─────────────────────────────────────────────────────────────────

class Project(_CamelModel):
    id: str
    title: str
    thumbnail: str
    current_phase: Phase
    phases: dict[Phase, PhaseStatus]
    scene_count: int
    created_at: str


class Scene(_CamelModel):
    id: str
    project_id: str
    number: int
    description: str
    location: str
    characters: list[str]
    duration: str


class Asset(_CamelModel):
    id: str
    project_id: str
    name: str
    type: AssetType
    status: AssetStatus
    emoji: str


class VendorScene(_CamelModel):
    id: str
    project_id: str
    scene_ref: str
    stage: VendorStage
    stage_status: VendorStageStatus
    retake_count: int
    completed_stages: list[VendorStage]
    approved: bool


class PostStage(_CamelModel):
    id: str
    name: str
    sub: str
    status: PostStatus
    parallel: bool = False
    track: str | None = None


class VoicePreview(_CamelModel):
    character: str
    voice: str
    audio_url: str
    duration_s: float


class ParseJob(_CamelModel):
    job_id: str
    project_id: str
    status: JobStatus
    progress: float = 0.0
    logs: list[str] = []
    scenes: list[Scene] = []
    error: str | None = None


# ── requests ──────────────────────────────────────────────────────────────────

class CreateProjectRequest(_CamelModel):
    title: str | None = None


class RenameProjectRequest(_CamelModel):
    title: str


class AdvancePhaseRequest(_CamelModel):
    to: Phase


class ParseScriptRequest(_CamelModel):
    text: str = ""
    filenames: list[str] = []
