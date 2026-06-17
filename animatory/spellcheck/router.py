# animatory/spellcheck/router.py
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from animatory import entity_registry
from animatory.spellcheck.chunker import segment_document
from animatory.spellcheck.checker import check_segment
from animatory.spellcheck.naming_pass import combined_naming_findings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["spellcheck"])


def _known_names(episode_id: str) -> dict:
    """Best-effort known names for the episode; empty if not chunked yet.
    Over WS we cannot return 404, so a missing episode just means no known names."""
    try:
        ep_dir = Path(os.environ.get("ANIMATORY_PROCESSED_DIR", "processed")) / episode_id
        return entity_registry.load(episode_id, ep_dir).known_names()
    except Exception:
        return {"characters": [], "locations": []}


@router.websocket("/episodes/{episode_id}/chunks/{chunk_id}/spellcheck/ws")
async def spellcheck_ws(websocket: WebSocket, episode_id: str, chunk_id: str):
    """Stream chunked spell-check findings.

    Protocol (see 2026-06-08-streaming-spellcheck-design.md §8):
      client -> {"action": "start", "document": "..."}
      server -> chunk_started / chunk_findings / naming_findings / complete / error
    One failing segment emits `error` for that segment without aborting the rest.
    All findings carry GLOBAL offsets into the document."""
    await websocket.accept()
    try:
        msg = await websocket.receive_json()
    except WebSocketDisconnect:
        return
    if not isinstance(msg, dict) or msg.get("action") != "start":
        await websocket.send_json({"type": "error_fatal", "message": "expected {action:'start'}"})
        await websocket.close()
        return

    document = msg.get("document") or ""
    known = _known_names(episode_id)
    segments = segment_document(document)
    total = len(segments)
    total_findings = 0

    try:
        for seg in segments:
            await websocket.send_json({
                "type": "chunk_started",
                "chunk_index": seg.segment_index,
                "total_chunks": total,
            })
            try:
                findings = await check_segment(seg.text, char_offset=seg.char_offset, known=known)
            except Exception as exc:  # one bad segment must not kill the stream
                logger.warning("[spellcheck] segment %d failed: %r", seg.segment_index, exc)
                await websocket.send_json({
                    "type": "error",
                    "chunk_index": seg.segment_index,
                    "message": str(exc),
                })
                continue
            total_findings += len(findings)
            await websocket.send_json({
                "type": "chunk_findings",
                "chunk_index": seg.segment_index,
                "findings": [f.to_dict() for f in findings],
            })

        naming = combined_naming_findings(document, known)
        total_findings += len(naming)
        await websocket.send_json({
            "type": "naming_findings",
            "findings": [f.to_dict() for f in naming],
        })

        await websocket.send_json({"type": "complete", "total_findings": total_findings})
    except WebSocketDisconnect:
        return
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
