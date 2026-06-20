# tests/test_genvoice.py
"""GenVoice is a scaffold: contracts live, TTS backend not yet wired."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from animatory.genvoice.schemas import VoiceSynthRequest
from animatory.genvoice.service import synthesize


@pytest.mark.asyncio
async def test_service_synthesize_is_not_implemented_yet():
    with pytest.raises(NotImplementedError):
        await synthesize(VoiceSynthRequest(text="xin chào"))


@pytest.mark.asyncio
async def test_synthesize_route_returns_501(client: AsyncClient):
    r = await client.post("/genvoice/synthesize", json={"text": "xin chào"})
    assert r.status_code == 501


@pytest.mark.asyncio
async def test_healthz_route(client: AsyncClient):
    r = await client.get("/genvoice/healthz")
    assert r.status_code == 200
    assert r.json()["implemented"] is False
