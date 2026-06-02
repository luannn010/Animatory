# tests/test_pipeline_api.py
from __future__ import annotations
import io, json
import pytest
from httpx import AsyncClient

TINY_TXT = b"Sentence one. Sentence two. " * 30  # ~180 words


@pytest.mark.asyncio
async def test_chunk_endpoint_returns_manifest(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("myep.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post("/pipeline/chunk", files=files)
    assert r.status_code == 200
    data = r.json()
    assert data["episode_id"] == "myep"
    assert data["chunk_count"] >= 1
    assert "output_dir" in data


@pytest.mark.asyncio
async def test_chunk_endpoint_custom_episode_id(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("transcript.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post("/pipeline/chunk?episode_id=ep99", files=files)
    assert r.status_code == 200
    assert r.json()["episode_id"] == "ep99"


@pytest.mark.asyncio
async def test_chunk_empty_file(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
    r = await client.post("/pipeline/chunk", files=files)
    assert r.status_code == 200
    assert r.json()["chunk_count"] == 0


@pytest.mark.asyncio
async def test_parse_endpoint_returns_run_id(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep1.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk", files=files)

    from unittest.mock import patch, AsyncMock
    with patch("animatory.pipeline_router.parse_episode", new_callable=AsyncMock) as mock_pe:
        mock_pe.return_value = []
        r = await client.post("/pipeline/parse/ep1")
    assert r.status_code == 200
    assert "run_id" in r.json()


@pytest.mark.asyncio
async def test_parse_missing_episode_404(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.post("/pipeline/parse/nonexistent_ep")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_episodes(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep2.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk", files=files)
    r = await client.get("/pipeline/episodes")
    assert r.status_code == 200
    episodes = r.json()
    ids = [e["episode_id"] for e in episodes]
    assert "ep2" in ids
