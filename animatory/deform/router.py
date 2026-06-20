"""FastAPI routes for mesh deform, mounted under ``/studio`` (spec §4).

Async submit + SSE, mirroring the studio parse-job seam and the imagegen
202+create_task pattern. Stores live on ``app.state`` (wired in ``server.py``):
``mesh_store`` (durable MeshData) and ``mesh_jobs`` (ephemeral jobs).
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image, UnidentifiedImageError
from sse_starlette.sse import EventSourceResponse

from animatory.deform.models import (
    GenerateMeshRequest,
    MeshData,
    MeshJob,
    SaveWeightsRequest,
)
from animatory.deform.service import run_mesh_job
from animatory.deform.store import MeshJobNotFound, MeshJobStore, MeshStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/studio", tags=["deform"])

_WEIGHT_SUM_EPS = 1e-3


def _mesh_store(request: Request) -> MeshStore:
    store = getattr(request.app.state, "mesh_store", None)
    if store is None:  # pragma: no cover - misconfiguration
        raise HTTPException(status_code=503, detail="deform not initialized")
    return store


def _jobs(request: Request) -> MeshJobStore:
    jobs = getattr(request.app.state, "mesh_jobs", None)
    if jobs is None:  # pragma: no cover - misconfiguration
        raise HTTPException(status_code=503, detail="deform not initialized")
    return jobs


def _decode_image(req: GenerateMeshRequest, out_dir: str) -> tuple[bytes, str]:
    """Resolve the request's image (R2) to (png_bytes, texture_url). Raises HTTPException."""
    if bool(req.image_data_url) == bool(req.image_ref):
        raise HTTPException(status_code=400, detail="provide exactly one of imageDataUrl or imageRef")

    if req.image_data_url:
        b64 = req.image_data_url.split(",", 1)[-1] if req.image_data_url.startswith("data:") else req.image_data_url
        try:
            data = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="imageDataUrl is not valid base64")
        texture_url = ""
    else:
        base = Path(out_dir).resolve()
        target = (base / req.image_ref).resolve()  # type: ignore[arg-type]
        if base not in target.parents and target != base:
            raise HTTPException(status_code=400, detail="imageRef escapes the outputs directory")
        if not target.is_file():
            raise HTTPException(status_code=404, detail=f"imageRef not found: {req.image_ref}")
        data = target.read_bytes()
        texture_url = f"/outputs/{req.image_ref.lstrip('/')}"  # type: ignore[union-attr]

    if not data:
        raise HTTPException(status_code=400, detail="image is empty")
    try:  # fail fast on non-images; the worker would otherwise only surface it as a failed job
        Image.open(BytesIO(data)).verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="image is not a readable PNG")
    return data, texture_url


@router.post("/assets/{asset_id}/mesh/generate", response_model=MeshJob, status_code=202)
async def generate_mesh(asset_id: str, req: GenerateMeshRequest, request: Request) -> MeshJob:
    if not req.bones:
        raise HTTPException(status_code=400, detail="at least one bind-pose bone is required")
    mesh_store = _mesh_store(request)
    jobs = _jobs(request)

    # One job per asset: a second generate while one runs returns the in-flight job (spec §5).
    in_flight = jobs.active(asset_id)
    if in_flight is not None:
        return in_flight

    out_dir = getattr(request.app.state, "image_out_dir", "out")
    image_bytes, texture_url = _decode_image(req, out_dir)

    await mesh_store.set_generating(asset_id)
    job = jobs.create(asset_id)

    request.app.state.mesh_tasks = getattr(request.app.state, "mesh_tasks", set())
    task = asyncio.create_task(
        run_mesh_job(
            mesh_store, jobs, job.job_id, asset_id, image_bytes, req.bones, req.params,
            texture_url=texture_url,
        )
    )
    request.app.state.mesh_tasks.add(task)
    task.add_done_callback(request.app.state.mesh_tasks.discard)
    return job


@router.get("/assets/{asset_id}/mesh/jobs/{job_id}", response_model=MeshJob)
async def get_mesh_job(asset_id: str, job_id: str, request: Request) -> MeshJob:
    try:
        return _jobs(request).get(job_id)
    except MeshJobNotFound:
        raise HTTPException(status_code=404, detail=f"mesh job '{job_id}' not found")


@router.get("/assets/{asset_id}/mesh/jobs/{job_id}/stream")
async def stream_mesh_job(asset_id: str, job_id: str, request: Request):
    jobs = _jobs(request)
    mesh_store = _mesh_store(request)
    try:
        jobs.get(job_id)
    except MeshJobNotFound:
        raise HTTPException(status_code=404, detail=f"mesh job '{job_id}' not found")

    async def event_generator():
        last_key = None
        terminal = {"done", "failed"}
        while True:
            job = jobs.get(job_id)
            key = (job.status, job.stage, round(job.progress, 3))
            if key != last_key:
                last_key = key
                yield {
                    "event": "progress",
                    "data": json.dumps(
                        {"jobId": job.job_id, "status": job.status, "stage": job.stage, "progress": job.progress}
                    ),
                }
            if job.status in terminal:
                if job.status == "done":
                    data = await mesh_store.get(asset_id)
                    yield {"event": "done", "data": data.model_dump_json(by_alias=True) if data else "{}"}
                else:
                    yield {
                        "event": "error",
                        "data": json.dumps({"jobId": job.job_id, "message": job.error or "mesh generation failed"}),
                    }
                break
            await asyncio.sleep(0.2)

    return EventSourceResponse(event_generator())


@router.get("/assets/{asset_id}/mesh", response_model=MeshData)
async def get_mesh(asset_id: str, request: Request) -> MeshData:
    data = await _mesh_store(request).get(asset_id)
    if data is None or data.status != "rigged":
        raise HTTPException(status_code=404, detail=f"no mesh for asset '{asset_id}'")
    return data


@router.put("/assets/{asset_id}/mesh/weights", response_model=MeshData)
async def save_weights(asset_id: str, body: SaveWeightsRequest, request: Request) -> MeshData:
    mesh_store = _mesh_store(request)
    data = await mesh_store.get(asset_id)
    if data is None or data.status != "rigged":
        raise HTTPException(status_code=404, detail=f"no mesh for asset '{asset_id}'")

    weights = body.weights
    n_verts = len(data.vertices) // 2
    if len(weights) != n_verts:
        raise HTTPException(status_code=422, detail=f"expected {n_verts} vertex weights, got {len(weights)}")
    valid = set(data.bind_pose.keys())
    for i, vw in enumerate(weights):
        if not vw.bones:
            raise HTTPException(status_code=422, detail=f"vertex {i}: at least one bone influence required")
        if len(vw.bones) != len(vw.values):
            raise HTTPException(status_code=422, detail=f"vertex {i}: bones/values length mismatch")
        if len(vw.bones) > 4:
            raise HTTPException(status_code=422, detail=f"vertex {i}: more than 4 bone influences")
        if abs(sum(vw.values) - 1.0) > _WEIGHT_SUM_EPS:
            raise HTTPException(status_code=422, detail=f"vertex {i}: weights sum to {sum(vw.values):.4f}, must be 1.0")
        unknown = [b for b in vw.bones if b not in valid]
        if unknown:
            raise HTTPException(status_code=422, detail=f"vertex {i}: unknown bone(s) {unknown}")

    data.weights = weights
    await mesh_store.save(data)
    return data


@router.delete("/assets/{asset_id}/mesh", status_code=204)
async def delete_mesh(asset_id: str, request: Request) -> Response:
    await _mesh_store(request).delete(asset_id)
    return Response(status_code=204)
