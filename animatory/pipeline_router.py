# animatory/pipeline_router.py
from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from animatory.chunker import chunk_file
from animatory.models import RunRecord, RunStatusEnum
from animatory.scene_parser import parse_episode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


def _processed_dir() -> Path:
    p = Path(os.environ.get("ANIMATORY_PROCESSED_DIR", "processed"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def _episode_status(ep_dir: Path) -> dict:
    manifest_path = ep_dir / "manifest.json"
    if not manifest_path.exists():
        return {"episode_id": ep_dir.name, "chunk_count": 0, "parsed_count": 0, "status": "empty"}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    chunk_count = manifest.get("chunk_count", 0)
    parsed_count = sum(
        1 for c in manifest.get("chunks", [])
        if (ep_dir / f"{c['chunk_id']}_scenes.json").exists()
    )
    if parsed_count == 0:
        status = "chunked"
    elif parsed_count < chunk_count:
        status = "partial"
    else:
        status = "complete"
    return {
        "episode_id": ep_dir.name,
        "chunk_count": chunk_count,
        "parsed_count": parsed_count,
        "status": status,
    }


@router.post("/chunk")
async def chunk_transcript(
    file: UploadFile = File(...),
    episode_id: str | None = Query(default=None),
):
    contents = await file.read()
    ep_id = episode_id or Path(file.filename or "episode").stem
    ep_dir = _processed_dir() / ep_id
    ep_dir.mkdir(parents=True, exist_ok=True)

    source_path = ep_dir / (file.filename or f"{ep_id}.txt")
    source_path.write_bytes(contents)

    manifest_path = chunk_file(source_path, ep_dir)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    return {
        "episode_id": ep_id,
        "chunk_count": manifest["chunk_count"],
        "output_dir": str(ep_dir),
    }


class ParseRequest(BaseModel):
    chunk_ids: list[str] | None = None


@router.post("/parse/{episode_id}")
async def parse_transcript(episode_id: str, request: Request, body: ParseRequest = ParseRequest()):
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")

    # Get store from app state — avoids circular import with server.py
    store = request.app.state.store

    run_id = str(uuid.uuid4())
    record = RunRecord(
        run_id=run_id,
        agent_id=f"pipeline.parse.{episode_id}",
        status=RunStatusEnum.queued,
        started_at=datetime.datetime.utcnow(),
    )
    await store.create(record)

    async def _run():
        await store.update(run_id, status=RunStatusEnum.running)
        try:
            paths = await parse_episode(
                episode_id,
                ep_dir,
                chunk_ids=body.chunk_ids,
            )
            logs = [f"Parsed {p.name}" for p in paths]
            await store.update(
                run_id,
                status=RunStatusEnum.done,
                finished_at=datetime.datetime.utcnow(),
                logs=logs,
            )
        except Exception as exc:
            logger.exception("parse_episode failed: %s", exc)
            await store.update(
                run_id,
                status=RunStatusEnum.failed,
                finished_at=datetime.datetime.utcnow(),
                error=str(exc),
            )

    asyncio.create_task(_run())
    return {"run_id": run_id}


@router.get("/episodes")
async def list_episodes():
    base = _processed_dir()
    return [
        _episode_status(d)
        for d in sorted(base.iterdir())
        if d.is_dir()
    ]
