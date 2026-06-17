"""Image-generation HTTP API (BACKEND_SPEC.md §9).

Async submit + poll: ``POST /generate`` enqueues a job (returns 202 immediately) and a
fire-and-forget ``asyncio.create_task`` runs ``service.run_job``; the API never blocks on
inference. Dependencies (job store, LoRA registry, shared engine) live on ``app.state`` and
are wired in ``server.py``'s lifespan.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from animatory.imagegen.jobs import ImageJobStore
from animatory.imagegen.lora import LoraRegistry
from animatory.imagegen.lora_train import _list_images
from animatory.imagegen.schemas import (
    AssetItem,
    GenerateResponse,
    GenerationRequest,
    HealthView,
    JobView,
    TrainJobView,
    TrainRequest,
    TrainResponse,
)
from animatory.imagegen.service import run_job, run_train_job
from animatory.zimage.train import _slug

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/imagegen", tags=["imagegen"])


def _store(request: Request) -> ImageJobStore:
    store = getattr(request.app.state, "image_job_store", None)
    if store is None:  # pragma: no cover - misconfiguration
        raise HTTPException(status_code=503, detail="imagegen not initialized")
    return store


def _registry(request: Request) -> LoraRegistry:
    return getattr(request.app.state, "lora_registry", None) or LoraRegistry()


def _job_view(rec: dict) -> JobView:
    return JobView(
        job_id=rec["job_id"], status=rec["status"], asset_type=rec.get("asset_type"),
        image_url=rec.get("image_url"), seed=rec.get("seed"),
        meta=rec.get("meta") or {}, error=rec.get("error"), created_at=rec.get("created_at"),
    )


@router.post("/generate", response_model=GenerateResponse, status_code=202)
async def generate(req: GenerationRequest, request: Request) -> GenerateResponse:
    store = _store(request)
    registry = _registry(request)
    engine = getattr(request.app.state, "image_engine", None)
    out_dir = getattr(request.app.state, "image_out_dir", "out")

    job_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    asset_type = req.asset_type.value
    await store.create(
        job_id, status="queued", asset_type=asset_type,
        character_id=req.character_id, scene_id=req.scene_id, created_at=now,
    )

    # Fire-and-forget; the worker serializes on the GPU lock internally.
    request.app.state.image_tasks = getattr(request.app.state, "image_tasks", set())
    task = asyncio.create_task(
        run_job(store, engine, registry, job_id, req, out_dir=out_dir)
    )
    request.app.state.image_tasks.add(task)
    task.add_done_callback(request.app.state.image_tasks.discard)

    return GenerateResponse(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}", response_model=JobView)
async def get_job(job_id: str, request: Request) -> JobView:
    rec = await _store(request).get(job_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"job '{job_id}' not found")
    return _job_view(rec)


@router.get("/assets", response_model=list[AssetItem])
async def list_assets(
    request: Request,
    type: str | None = Query(default=None),
    scene_id: str | None = Query(default=None),
    character_id: str | None = Query(default=None),
) -> list[AssetItem]:
    rows = await _store(request).list(
        asset_type=type, scene_id=scene_id, character_id=character_id, status="done",
    )
    return [
        AssetItem(
            job_id=r["job_id"], asset_type=r.get("asset_type") or "",
            image_url=r.get("image_url"), seed=r.get("seed"),
            character_id=r.get("character_id"), scene_id=r.get("scene_id"),
            created_at=r.get("created_at"),
        )
        for r in rows
    ]


@router.get("/loras", response_model=list[str])
async def list_loras(request: Request) -> list[str]:
    return _registry(request).list_available()


@router.get("/healthz", response_model=HealthView)
async def healthz(request: Request) -> HealthView:
    from animatory.zimage.brain import free_vram_mb

    engine = getattr(request.app.state, "image_engine", None)
    engine_loaded = bool(getattr(engine, "is_loaded", False))
    return HealthView(ok=True, free_vram_mb=free_vram_mb(), engine_loaded=engine_loaded)


# -- LoRA training -------------------------------------------------------------------------

def _rigs_dir(request: Request) -> str:
    cfg = getattr(request.app.state, "image_cfg", None)
    if cfg is not None:
        return str(cfg.rigs_dir)
    return os.environ.get("ZIMAGE_RIGS_DIR", "rigs")


@router.post("/loras/train", response_model=TrainResponse, status_code=202)
async def train_lora(req: TrainRequest, request: Request) -> TrainResponse:
    store = _store(request)
    registry = _registry(request)
    engine = getattr(request.app.state, "image_engine", None)
    rigs_dir = _rigs_dir(request)
    slug = _slug(req.name)

    refs_dir = Path(req.refs_dir) if req.refs_dir else Path(rigs_dir) / "character" / slug / "refs"
    images = _list_images(refs_dir)
    if not images:
        raise HTTPException(
            status_code=400,
            detail=(f"no training images in {refs_dir} — build the rig and drop 8-12 reference "
                    "images there first (or pass refs_dir)."),
        )

    job_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    await store.create(job_id, status="queued", asset_type="lora",
                       character_id=slug, created_at=now)

    cfg = {
        "name": req.name, "refs_dir": str(refs_dir), "trigger": req.trigger,
        "caption": req.caption, "steps": req.steps, "rank": req.rank, "lr": req.lr,
        "resolution": req.resolution, "strength": req.strength,
        "lora_dir": str(registry.lora_dir), "rigs_dir": rigs_dir,
    }
    request.app.state.image_tasks = getattr(request.app.state, "image_tasks", set())
    task = asyncio.create_task(run_train_job(store, engine, job_id, cfg))
    request.app.state.image_tasks.add(task)
    task.add_done_callback(request.app.state.image_tasks.discard)

    return TrainResponse(job_id=job_id, status="queued")


@router.get("/trainings/{job_id}", response_model=TrainJobView)
async def get_training(job_id: str, request: Request) -> TrainJobView:
    rec = await _store(request).get(job_id)
    if rec is None or rec.get("asset_type") != "lora":
        raise HTTPException(status_code=404, detail=f"training '{job_id}' not found")
    meta = rec.get("meta") or {}
    return TrainJobView(
        job_id=rec["job_id"], status=rec["status"], name=meta.get("name"),
        step=meta.get("step"), total=meta.get("total"), loss=meta.get("loss"),
        lora_name=meta.get("lora_name"), error=rec.get("error"),
        created_at=rec.get("created_at"),
    )
