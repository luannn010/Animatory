from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from animatory.models import (
    AgentListItem,
    MetricsSnapshot,
    RunRecord,
    RunRequest,
    RunResponse,
    RunStatusEnum,
)
from animatory.registry import load_registry, AgentRegistry
from animatory.run_store import RunStore, InMemoryRunStore
from animatory.base_agent import BaseAgent
from animatory.executors.fake import FakeExecutor
from animatory.executors.comfyui import ComfyUIExecutor
from animatory.executors.llamacpp import LlamaCppExecutor
from animatory.studio.router import router as studio_router
from animatory.studio.store import StudioStore

logger = logging.getLogger(__name__)


def _configure_logging() -> None:
    """Ensure animatory.* INFO logs are visible alongside uvicorn's output.

    Uvicorn does not configure application loggers, so without this the
    pipeline/scene-parser INFO logs (endpoint, stage, real error) are dropped.
    """
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    app_logger = logging.getLogger("animatory")
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        app_logger.addHandler(handler)
        app_logger.propagate = False
    app_logger.setLevel(level)


_configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yaml_path = os.environ.get("ANIMATORY_YAML_PATH", "agent-framework.yaml")
    registry = load_registry(yaml_path)

    db_path = os.environ.get("DB_PATH", "animatory.db")
    store = InMemoryRunStore() if db_path == ":memory:" else RunStore(db_path)
    await store.init()

    if os.environ.get("ANIMATORY_FAKE_EXECUTORS", "0") == "1":
        fake = FakeExecutor()
        executor_map = {s: fake for s in ["comfyui", "text", "orchestration", "audio", "image", "video", "utility"]}
    else:
        executor_map: dict = {
            "comfyui": ComfyUIExecutor(),
            "text": LlamaCppExecutor(),
            "orchestration": LlamaCppExecutor(),
        }

    studio_store = StudioStore(db_path=db_path)
    await studio_store.init()

    app.state.registry = registry
    app.state.store = store
    app.state.executor_map = executor_map
    app.state.studio_store = studio_store

    yield

    await studio_store.close()


app = FastAPI(title="Animatory Backend", version="0.1.0", lifespan=lifespan)

_cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(studio_router)
from animatory.pipeline_router import router as pipeline_router
app.include_router(pipeline_router)


@app.get("/health")
async def health():
    registry: AgentRegistry = app.state.registry
    return {"ok": True, "status": "ok", "agents_loaded": len(registry.all())}


@app.get("/agents", response_model=list[AgentListItem])
async def list_agents():
    registry: AgentRegistry = app.state.registry
    return [
        AgentListItem(
            id=a.id,
            name=a.name,
            layer=a.layer,
            stack=a.stack,
            role=a.role,
            responsibility=a.responsibility,
            status=a.status,
            inputs=a.inputs,
            outputs=a.outputs,
            trigger=a.trigger,
            idempotent=a.idempotent,
            retry=a.retry,
            timeout_s=a.timeout_s,
            acceptance=a.acceptance,
            cost_estimate=a.cost_estimate,
        )
        for a in registry.all()
    ]


@app.post("/agents/{agent_id}/run", response_model=RunResponse)
async def run_agent(agent_id: str, request: RunRequest):
    registry: AgentRegistry = app.state.registry
    store: RunStore = app.state.store
    executor_map: dict = app.state.executor_map

    try:
        definition = registry.get(agent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    stack_key = definition.stack.value
    executor = executor_map.get(stack_key, FakeExecutor())

    agent = BaseAgent(definition, executor, store)

    # Pre-generate run_id so we can return it immediately
    run_id = str(uuid.uuid4())
    agent._run_id = run_id

    record = RunRecord(
        run_id=run_id,
        agent_id=agent_id,
        status=RunStatusEnum.queued,
        started_at=datetime.datetime.now(datetime.timezone.utc),
        episode_id=request.context.get("episode_id"),
        phase=request.context.get("phase"),
        track=request.context.get("track"),
    )
    await store.create(record)

    async def _run_background():
        try:
            # Patch agent so it skips re-creating the record
            agent._preseeded = True
            await _agent_run_with_existing_record(agent, request, record)
        except Exception as exc:
            logger.exception("Background agent run failed: %s", exc)

    asyncio.create_task(_run_background())
    return RunResponse(run_id=run_id)


async def _agent_run_with_existing_record(agent: BaseAgent, request: RunRequest, record: RunRecord):
    """Run agent lifecycle using a pre-created record (avoids double-create)."""
    store = agent.store
    definition = agent.definition
    run_id = record.run_id
    now = record.started_at or datetime.datetime.now(datetime.timezone.utc)

    required = [inp.name for inp in definition.inputs if inp.required]
    missing = [name for name in required if name not in request.context]
    if missing:
        await store.update(run_id, status=RunStatusEnum.failed, error=f"Missing required inputs: {missing}", finished_at=datetime.datetime.now(datetime.timezone.utc))
        return

    for cond in definition.preconditions:
        if not agent._check_precondition(cond, request.context):
            await store.update(run_id, status=RunStatusEnum.failed, error=f"Precondition failed: {cond}", finished_at=datetime.datetime.now(datetime.timezone.utc))
            return

    max_attempts = max(definition.retry.max_attempts, 1)
    result = None

    for attempt in range(1, max_attempts + 1):
        status = RunStatusEnum.running if attempt == 1 else RunStatusEnum.retrying
        if attempt > 1:
            backoff_s = agent._apply_backoff(attempt)
            if backoff_s > 0:
                await asyncio.sleep(backoff_s)
        await store.update(run_id, status=status, attempts=attempt)

        try:
            result = await asyncio.wait_for(agent.executor.execute(request, definition), timeout=float(definition.timeout_s))
        except asyncio.TimeoutError:
            msg = f"Timed out on attempt {attempt}"
            if attempt < max_attempts:
                continue
            await store.update(run_id, status=RunStatusEnum.failed, error=msg, finished_at=datetime.datetime.now(datetime.timezone.utc))
            return
        except Exception as exc:
            msg = str(exc)
            if attempt < max_attempts:
                continue
            await store.update(run_id, status=RunStatusEnum.failed, error=msg, finished_at=datetime.datetime.now(datetime.timezone.utc))
            return

        if result.error:
            if attempt < max_attempts:
                continue
            await store.update(run_id, status=RunStatusEnum.failed, error=result.error, finished_at=datetime.datetime.now(datetime.timezone.utc))
            return
        break

    finished_at = datetime.datetime.now(datetime.timezone.utc)
    duration_s = (finished_at - now).total_seconds()
    acceptance_passed = True

    await store.update(
        run_id,
        status=RunStatusEnum.done,
        finished_at=finished_at,
        duration_s=duration_s,
        cost=result.cost if result else None,
        gpu_seconds=result.gpu_seconds if result else None,
        tokens=result.tokens if result else None,
        acceptance_passed=acceptance_passed,
        outputs=result.outputs if result else [],
    )


@app.get("/runs", response_model=list[RunRecord])
async def list_runs(
    agent_id: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
):
    store: RunStore = app.state.store
    if agent_id:
        return await store.list_by_agent(agent_id)
    return await store.list_all(limit)


@app.get("/metrics", response_model=MetricsSnapshot)
async def get_metrics(agent_id: str | None = Query(default=None)):
    store: RunStore = app.state.store
    data = await store.metrics(agent_id)
    return MetricsSnapshot(**data)


@app.get("/runs/{run_id}", response_model=RunRecord)
async def get_run(run_id: str):
    store: RunStore = app.state.store
    record = await store.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return record


@app.get("/runs/{run_id}/stream")
async def stream_run(run_id: str):
    store: RunStore = app.state.store

    initial = await store.get(run_id)
    if initial is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    async def event_generator():
        last_status = None
        last_log_count = 0
        terminal = {"done", "failed"}

        while True:
            record: RunRecord | None = await store.get(run_id)
            if record is None:
                break

            current_status = record.status.value if hasattr(record.status, "value") else str(record.status)

            if current_status != last_status:
                last_status = current_status
                yield {"event": "status", "data": json.dumps({"status": current_status, "attempts": record.attempts})}

            logs = record.logs or []
            for msg in logs[last_log_count:]:
                yield {"event": "log", "data": json.dumps({"message": msg})}
            last_log_count = len(logs)

            if current_status in terminal:
                yield {"event": "done", "data": record.model_dump_json()}
                break

            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())
