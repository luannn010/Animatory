# animatory/genvoice/router.py
"""GenVoice HTTP API (scaffold).

The contract is live so the frontend/orchestrator can integrate against it; the
synthesize endpoint returns 501 until a TTS backend is wired into
``service.synthesize``.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from animatory.genvoice.schemas import VoiceSynthRequest, VoiceSynthResponse

router = APIRouter(prefix="/genvoice", tags=["genvoice"])


@router.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "implemented": False}


@router.post("/synthesize", response_model=VoiceSynthResponse)
async def synthesize(req: VoiceSynthRequest) -> VoiceSynthResponse:
    # Scaffold: contracts defined, TTS backend not yet wired (see service.py).
    raise HTTPException(status_code=501, detail="genvoice TTS not implemented yet")
