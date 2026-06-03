"""FastAPI routes for the studio surface, mounted under ``/studio``.

Mirrors the frontend ``studioApi`` method-for-method, plus a background parse
job with an SSE stream. The store is read from ``app.state.studio_store`` so it
shares the application's lifespan.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from animatory.studio.models import (
    AdvancePhaseRequest, Asset, CreateProjectRequest, ParseJob, ParseScriptRequest,
    PostStage, Project, RenameProjectRequest, Scene, VendorScene, VoicePreview,
)
from animatory.studio.store import JobNotFound, ProjectNotFound, StudioStore

router = APIRouter(prefix="/studio", tags=["studio"])


def _store(request: Request) -> StudioStore:
    return request.app.state.studio_store


def _project_or_404(store: StudioStore, project_id: str) -> Project:
    try:
        return store.get_project(project_id)
    except ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")


# ── projects ──────────────────────────────────────────────────────────────────

@router.get("/projects", response_model=list[Project])
async def list_projects(request: Request):
    return _store(request).list_projects()


@router.post("/projects", response_model=Project)
async def create_project(request: Request, body: CreateProjectRequest):
    return await _store(request).create_project(body.title)


@router.get("/projects/{project_id}", response_model=Project)
async def get_project(request: Request, project_id: str):
    return _project_or_404(_store(request), project_id)


@router.patch("/projects/{project_id}", response_model=Project)
async def rename_project(request: Request, project_id: str, body: RenameProjectRequest):
    store = _store(request)
    _project_or_404(store, project_id)
    return await store.update_title(project_id, body.title)


@router.post("/projects/{project_id}/advance", response_model=Project)
async def advance_phase(request: Request, project_id: str, body: AdvancePhaseRequest):
    store = _store(request)
    _project_or_404(store, project_id)
    return await store.advance_phase(project_id, body.to)


# ── child resources ───────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/scenes", response_model=list[Scene])
async def get_scenes(request: Request, project_id: str):
    store = _store(request)
    _project_or_404(store, project_id)
    return store.get_scenes(project_id)


@router.get("/projects/{project_id}/assets", response_model=list[Asset])
async def get_assets(request: Request, project_id: str):
    store = _store(request)
    _project_or_404(store, project_id)
    return store.get_assets(project_id)


@router.get("/projects/{project_id}/vendor-scenes", response_model=list[VendorScene])
async def get_vendor_scenes(request: Request, project_id: str):
    store = _store(request)
    _project_or_404(store, project_id)
    return store.get_vendor_scenes(project_id)


@router.get("/projects/{project_id}/post-stages", response_model=list[PostStage])
async def get_post_stages(request: Request, project_id: str):
    store = _store(request)
    _project_or_404(store, project_id)
    return store.get_post_stages(project_id)


# ── voice casting (TTS seam) ──────────────────────────────────────────────────

@router.post("/projects/{project_id}/casting/{character}/preview", response_model=VoicePreview)
async def voice_preview(request: Request, project_id: str, character: str, voice: str = "Voice A"):
    store = _store(request)
    _project_or_404(store, project_id)
    return await store.voice_preview(project_id, character, voice)


# ── parse job (LLM seam) ──────────────────────────────────────────────────────

@router.post("/projects/{project_id}/parse", response_model=ParseJob)
async def start_parse(request: Request, project_id: str, body: ParseScriptRequest):
    store = _store(request)
    _project_or_404(store, project_id)
    return store.start_parse(project_id, body.text, body.filenames)


@router.get("/parse-jobs/{job_id}", response_model=ParseJob)
async def get_parse_job(request: Request, job_id: str):
    try:
        return _store(request).get_job(job_id)
    except JobNotFound:
        raise HTTPException(status_code=404, detail=f"Parse job '{job_id}' not found")


@router.get("/parse-jobs/{job_id}/stream")
async def stream_parse_job(request: Request, job_id: str):
    store = _store(request)
    try:
        store.get_job(job_id)
    except JobNotFound:
        raise HTTPException(status_code=404, detail=f"Parse job '{job_id}' not found")

    async def event_generator():
        last_status = None
        last_log_count = 0
        terminal = {"done", "failed"}

        while True:
            job = store.get_job(job_id)
            status = job.status.value if hasattr(job.status, "value") else str(job.status)

            if status != last_status:
                last_status = status
                yield {"event": "status", "data": json.dumps({"status": status, "progress": job.progress})}

            for msg in job.logs[last_log_count:]:
                yield {"event": "log", "data": json.dumps({"message": msg})}
            last_log_count = len(job.logs)

            if status in terminal:
                yield {"event": "done", "data": job.model_dump_json(by_alias=True)}
                break

            await asyncio.sleep(0.2)

    return EventSourceResponse(event_generator())
