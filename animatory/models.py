from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class LayerEnum(str, Enum):
    orchestration = "orchestration"
    execution = "execution"
    audit = "audit"


class StackEnum(str, Enum):
    orchestration = "orchestration"
    comfyui = "comfyui"
    text = "text"
    audio = "audio"
    image = "image"
    video = "video"
    utility = "utility"


class StatusEnum(str, Enum):
    idle = "idle"
    running = "running"
    retrying = "retrying"
    done = "done"
    failed = "failed"


class TriggerEnum(str, Enum):
    called_by_orchestrator = "called_by_orchestrator"
    event = "event"
    manual = "manual"


class BackoffEnum(str, Enum):
    none = "none"
    linear = "linear"
    exponential = "exponential"


class OnFailEnum(str, Enum):
    retry = "retry"
    escalate = "escalate"
    skip = "skip"
    halt = "halt"


class RunStatusEnum(str, Enum):
    queued = "queued"
    running = "running"
    retrying = "retrying"
    done = "done"
    failed = "failed"


class AgentInput(BaseModel):
    name: str
    type: str
    required: bool = True


class AgentOutput(BaseModel):
    name: str
    type: str
    path: str


class RetryConfig(BaseModel):
    max_attempts: int = 1
    backoff: BackoffEnum = BackoffEnum.none


class AgentDef(BaseModel):
    id: str
    name: str
    layer: LayerEnum
    stack: StackEnum
    role: str
    responsibility: str
    status: StatusEnum = StatusEnum.idle
    inputs: list[AgentInput] = []
    outputs: list[AgentOutput] = []
    trigger: TriggerEnum = TriggerEnum.called_by_orchestrator
    idempotent: bool = False
    retry: RetryConfig = RetryConfig()
    timeout_s: int = 300
    preconditions: list[str] = []
    acceptance: list[str] = []
    on_fail: OnFailEnum = OnFailEnum.retry
    emits_metrics: list[str] = []
    cost_estimate: str = "unknown"
    workflow_files: list[str] = []
    gpu_required: bool = False
    checkpoint: str | None = None
    consistency_ref: str | None = None
    model_suggested: str | None = None
    structured_output: bool = False
    prompt_template: str | None = None
    grounding_refs: list[str] = []
    subtype: str | None = None
    voice_profiles: list[str] = []
    views_required: list[str] = []
    sub_workflows: list[str] = []
    spawns: list[str] = []
    gates: list[str] = []
    loops: bool = False
    decision_model: str | None = None


class OutputArtifact(BaseModel):
    name: str
    type: str
    path: str
    artifact_url: str | None = None


class RunRecord(BaseModel):
    run_id: str
    agent_id: str
    status: RunStatusEnum = RunStatusEnum.queued
    attempts: int = 0
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_s: float | None = None
    cost: float | None = None
    gpu_seconds: float | None = None
    tokens: int | None = None
    acceptance_passed: bool | None = None
    outputs: list[OutputArtifact] = []
    error: str | None = None
    logs: list[str] = []
    episode_id: str | None = None
    phase: str | None = None
    track: str | None = None


class RunRequest(BaseModel):
    context: dict = {}
    system_prompt: str = ""


class RunResponse(BaseModel):
    run_id: str


class AgentListItem(BaseModel):
    id: str
    name: str
    layer: LayerEnum
    stack: StackEnum
    role: str
    responsibility: str = ""
    status: StatusEnum = StatusEnum.idle
    inputs: list[AgentInput]
    outputs: list[AgentOutput]
    trigger: TriggerEnum = TriggerEnum.called_by_orchestrator
    idempotent: bool = False
    retry: RetryConfig = RetryConfig()
    timeout_s: int = 300
    acceptance: list[str] = []
    cost_estimate: str = "unknown"


class ExecutorResult(BaseModel):
    outputs: list[OutputArtifact] = []
    metrics: dict = {}
    error: str | None = None
    tokens: int | None = None
    gpu_seconds: float | None = None
    cost: float | None = None
