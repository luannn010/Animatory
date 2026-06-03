# animatory/pipeline_router.py
from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, File, HTTPException, Query, Request, UploadFile
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


def _chunk_meta(ep_dir: Path, chunk_id: str) -> dict:
    """Manifest entry for a chunk, or raise 404. Also 404s if not chunked."""
    manifest_path = ep_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail=f"Episode '{ep_dir.name}' not found or not chunked yet")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    meta = next((c for c in manifest.get("chunks", []) if c["chunk_id"] == chunk_id), None)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found in episode '{ep_dir.name}'")
    return meta


def _text_payload(ep_dir: Path, chunk_id: str, meta: dict) -> dict:
    edited = ep_dir / f"{chunk_id}.edited.txt"
    if edited.exists():
        text, is_edited = edited.read_text(encoding="utf-8"), True
    else:
        text, is_edited = (ep_dir / meta["file"]).read_text(encoding="utf-8"), False
    return {"chunk_id": chunk_id, "file": meta["file"],
            "word_count": meta.get("word_count"), "text": text, "edited": is_edited}


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
        "display_name": manifest.get("display_name"),
        "chunk_count": chunk_count,
        "parsed_count": parsed_count,
        "status": status,
    }


@router.post("/chunk")
async def chunk_transcript(
    file: UploadFile = File(...),
    episode_id: str | None = Query(default=None),
    name: str | None = Query(default=None),
):
    contents = await file.read()
    # .strip() guards against trailing whitespace in episode_id (e.g. "ep1 "):
    # Windows silently strips it when creating the dir, but not from the file path,
    # which produced FileNotFoundError on 'processed\\ep1 \\test.txt'.
    ep_id = (episode_id or Path(file.filename or "episode").stem).strip()
    ep_dir = _processed_dir() / ep_id
    ep_dir.mkdir(parents=True, exist_ok=True)

    source_path = ep_dir / (file.filename or f"{ep_id}.txt")
    logger.info(
        "[chunk] episode=%s file=%s bytes=%d -> %s",
        ep_id, file.filename, len(contents), source_path,
    )
    source_path.write_bytes(contents)

    manifest_path = chunk_file(source_path, ep_dir)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # Persist the human-friendly transcript name so the card title survives reloads.
    display_name = (name or "").strip() or Path(file.filename or ep_id).stem
    manifest["display_name"] = display_name
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info("[chunk] episode=%s chunked into %d chunk(s)", ep_id, manifest["chunk_count"])

    return {
        "episode_id": ep_id,
        "display_name": display_name,
        "chunk_count": manifest["chunk_count"],
        "output_dir": str(ep_dir),
    }


class ParseRequest(BaseModel):
    chunk_ids: list[str] | None = None


class SaveTextRequest(BaseModel):
    text: str


@router.post("/parse/{episode_id}")
async def parse_transcript(
    episode_id: str,
    request: Request,
    body: ParseRequest = Body(default=ParseRequest()),
):
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
        started_at=datetime.datetime.now(datetime.timezone.utc),
    )
    await store.create(record)

    logger.info(
        "[parse] run=%s episode=%s queued (chunk_ids=%s)",
        run_id, episode_id, body.chunk_ids or "all",
    )

    async def _on_progress(done: int, total: int, chunk_id: str):
        # Append one streamed log line per chunk. The SSE stream polls record.logs
        # and pushes each new line, so the UI can show live progress (done/total)
        # and a running log. The [done/total] tag is what the frontend parses.
        line = (
            f"[0/{total}] Parsing {total} chunk(s)…"
            if done == 0
            else f"[{done}/{total}] Parsed {chunk_id}"
        )
        rec = await store.get(run_id)
        await store.update(run_id, logs=(rec.logs or []) + [line])

    async def _run():
        logger.info("[parse] run=%s episode=%s started", run_id, episode_id)
        await store.update(run_id, status=RunStatusEnum.running)
        try:
            paths = await parse_episode(
                episode_id,
                ep_dir,
                chunk_ids=body.chunk_ids,
                on_progress=_on_progress,
            )
            logs = [f"Parsed {p.name}" for p in paths]
            logger.info("[parse] run=%s episode=%s done: %d file(s)", run_id, episode_id, len(paths))
            await store.update(
                run_id,
                status=RunStatusEnum.done,
                finished_at=datetime.datetime.now(datetime.timezone.utc),
                logs=logs,
            )
        except Exception as exc:
            logger.exception("[parse] run=%s episode=%s FAILED: %s", run_id, episode_id, exc)
            await store.update(
                run_id,
                status=RunStatusEnum.failed,
                finished_at=datetime.datetime.now(datetime.timezone.utc),
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


def _episode_chunks(ep_dir: Path) -> dict:
    """Per-chunk detail for an episode, including individual parse status."""
    manifest = json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    chunks = []
    parsed_count = 0
    for c in manifest.get("chunks", []):
        scenes_path = ep_dir / f"{c['chunk_id']}_scenes.json"
        parsed = scenes_path.exists()
        scene_count: int | None = None
        if parsed:
            parsed_count += 1
            try:
                scene_count = len(json.loads(scenes_path.read_text(encoding="utf-8")).get("scenes", []))
            except (json.JSONDecodeError, OSError):
                scene_count = None
        chunks.append({
            "chunk_id": c["chunk_id"],
            "file": c["file"],
            "word_count": c.get("word_count"),
            "parsed": parsed,
            "scene_count": scene_count,
        })

    chunk_count = manifest.get("chunk_count", len(chunks))
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
        "chunks": chunks,
    }


@router.get("/episodes/{episode_id}/chunks")
async def list_episode_chunks(episode_id: str):
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")
    return _episode_chunks(ep_dir)


@router.get("/episodes/{episode_id}/chunks/{chunk_id}/scenes")
async def get_chunk_scenes(episode_id: str, chunk_id: str):
    """Return the rendered shot list for a single parsed chunk.

    Surfaces the contents of {chunk_id}_scenes.json so the frontend can show
    scenes directly — no raw JSON in the UI. 409 if the chunk exists but has
    not been parsed yet.
    """
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")

    manifest = json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    if not any(c["chunk_id"] == chunk_id for c in manifest.get("chunks", [])):
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found in episode '{episode_id}'")

    scenes_path = ep_dir / f"{chunk_id}_scenes.json"
    if not scenes_path.exists():
        raise HTTPException(status_code=409, detail=f"Chunk '{chunk_id}' has not been parsed yet")

    try:
        return json.loads(scenes_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read scenes for '{chunk_id}': {exc}") from exc


@router.get("/episodes/{episode_id}/chunks/{chunk_id}/text")
async def get_chunk_text(episode_id: str, chunk_id: str):
    """Return the text for a single chunk, preferring the edited version if present.

    Available as soon as the episode is chunked — independent of parsing — so the
    chapter view can show the original chapter text alongside its scenes.
    """
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    txt_path = ep_dir / meta["file"]
    if not txt_path.exists():
        raise HTTPException(status_code=404, detail=f"Text file for '{chunk_id}' is missing")
    return _text_payload(ep_dir, chunk_id, meta)


@router.put("/episodes/{episode_id}/chunks/{chunk_id}/text")
async def save_chunk_text(episode_id: str, chunk_id: str, body: SaveTextRequest):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    (ep_dir / f"{chunk_id}.edited.txt").write_text(body.text, encoding="utf-8")
    logger.info("[text] episode=%s chunk=%s saved edited text (%d chars)",
                episode_id, chunk_id, len(body.text))
    return _text_payload(ep_dir, chunk_id, meta)


@router.delete("/episodes/{episode_id}/chunks/{chunk_id}/text/edited")
async def reset_chunk_text(episode_id: str, chunk_id: str):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    edited = ep_dir / f"{chunk_id}.edited.txt"
    if edited.exists():
        edited.unlink()
    return _text_payload(ep_dir, chunk_id, meta)
