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

    import asyncio
    from unittest.mock import patch, AsyncMock
    with patch("animatory.pipeline_router.parse_episode", new_callable=AsyncMock) as mock_pe:
        mock_pe.return_value = []
        r = await client.post("/pipeline/parse/ep1")
        assert r.status_code == 200
        assert "run_id" in r.json()
        # The endpoint schedules the parse via asyncio.create_task (fire-and-forget).
        # Drain that background task *while the mock is still active* — otherwise it
        # escapes the patch context and calls the real parse_episode, which hits the
        # real Qwen server and blocks the whole suite.
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        if pending:
            await asyncio.wait(pending, timeout=5)
        assert mock_pe.await_count == 1


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


@pytest.mark.asyncio
async def test_list_episode_chunks(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep3.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk?episode_id=ep3", files=files)

    r = await client.get("/pipeline/episodes/ep3/chunks")
    assert r.status_code == 200
    data = r.json()
    assert data["episode_id"] == "ep3"
    assert data["chunk_count"] >= 1
    assert data["parsed_count"] == 0
    assert data["status"] == "chunked"
    assert len(data["chunks"]) == data["chunk_count"]
    first = data["chunks"][0]
    assert first["parsed"] is False
    assert "chunk_id" in first and "file" in first


@pytest.mark.asyncio
async def test_list_episode_chunks_404(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.get("/pipeline/episodes/nonexistent_ep/chunks")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_chunk_scenes_returns_parsed_scenes(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep4.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk?episode_id=ep4", files=files)

    chunks = (await client.get("/pipeline/episodes/ep4/chunks")).json()["chunks"]
    chunk_id = chunks[0]["chunk_id"]

    # Simulate a completed parse by writing the scenes file the parser would emit.
    scenes_doc = {
        "chunk_id": chunk_id,
        "source_file": "ep4.txt",
        "model": "qwen3.5",
        "parsed_at": "2026-06-02T10:00:00Z",
        "scenes": [
            {
                "scene_id": f"{chunk_id}_S01",
                "location": "Phòng công chúa",
                "characters": ["Tú An", "Tiểu Lan Nhi"],
                "shot_type": "medium",
                "action": "Tú An bị trói trên giường.",
                "dialogue": [{"character": "Tú An", "line": "Mẹ kiếp, nhận nhầm rồi..."}],
                "mood": "căng thẳng",
            }
        ],
    }
    (tmp_path / "ep4" / f"{chunk_id}_scenes.json").write_text(
        json.dumps(scenes_doc, ensure_ascii=False), encoding="utf-8"
    )

    r = await client.get(f"/pipeline/episodes/ep4/chunks/{chunk_id}/scenes")
    assert r.status_code == 200
    data = r.json()
    assert data["chunk_id"] == chunk_id
    assert len(data["scenes"]) == 1
    scene = data["scenes"][0]
    assert scene["shot_type"] == "medium"
    assert scene["characters"] == ["Tú An", "Tiểu Lan Nhi"]
    assert scene["dialogue"][0]["character"] == "Tú An"


@pytest.mark.asyncio
async def test_get_chunk_scenes_409_when_not_parsed(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep5.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk?episode_id=ep5", files=files)
    chunk_id = (await client.get("/pipeline/episodes/ep5/chunks")).json()["chunks"][0]["chunk_id"]

    r = await client.get(f"/pipeline/episodes/ep5/chunks/{chunk_id}/scenes")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_get_chunk_scenes_404_unknown_chunk(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep6.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk?episode_id=ep6", files=files)

    r = await client.get("/pipeline/episodes/ep6/chunks/C999/scenes")
    assert r.status_code == 404

    r2 = await client.get("/pipeline/episodes/nope/chunks/C001/scenes")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_get_chunk_text(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep7.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk?episode_id=ep7", files=files)

    chunk_id = (await client.get("/pipeline/episodes/ep7/chunks")).json()["chunks"][0]["chunk_id"]
    r = await client.get(f"/pipeline/episodes/ep7/chunks/{chunk_id}/text")
    assert r.status_code == 200
    data = r.json()
    assert data["chunk_id"] == chunk_id
    assert data["word_count"] >= 1
    assert "Sentence one." in data["text"]


@pytest.mark.asyncio
async def test_get_chunk_text_404(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep8.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk?episode_id=ep8", files=files)

    assert (await client.get("/pipeline/episodes/ep8/chunks/C999/text")).status_code == 404
    assert (await client.get("/pipeline/episodes/nope/chunks/C001/text")).status_code == 404
