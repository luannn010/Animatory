# tests/test_pipeline_api.py
from __future__ import annotations
import io, json
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch

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
async def test_chunk_persists_display_name(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("raw.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post("/pipeline/chunk?episode_id=proj__ch1&name=Chapter%20One", files=files)
    assert r.status_code == 200
    assert r.json()["display_name"] == "Chapter One"

    # display_name comes back on the episode listing (survives reload).
    episodes = (await client.get("/pipeline/episodes")).json()
    ep = next(e for e in episodes if e["episode_id"] == "proj__ch1")
    assert ep["display_name"] == "Chapter One"


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


async def _chunk_one(client, tmp_path, monkeypatch, ep):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": (f"{ep}.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post(f"/pipeline/chunk?episode_id={ep}", files=files)
    return (await client.get(f"/pipeline/episodes/{ep}/chunks")).json()["chunks"][0]["chunk_id"]


@pytest.mark.asyncio
async def test_save_and_get_edited_text(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "te1")

    r = await client.put(f"/pipeline/episodes/te1/chunks/{cid}/text",
                         json={"text": "cleaned chapter text"})
    assert r.status_code == 200
    assert r.json()["edited"] is True

    g = await client.get(f"/pipeline/episodes/te1/chunks/{cid}/text")
    assert g.json()["text"] == "cleaned chapter text"
    assert g.json()["edited"] is True


@pytest.mark.asyncio
async def test_reset_edited_text(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "te2")
    await client.put(f"/pipeline/episodes/te2/chunks/{cid}/text", json={"text": "edited"})

    d = await client.delete(f"/pipeline/episodes/te2/chunks/{cid}/text/edited")
    assert d.status_code == 200
    assert d.json()["edited"] is False

    g = await client.get(f"/pipeline/episodes/te2/chunks/{cid}/text")
    assert "Sentence one." in g.json()["text"]
    assert g.json()["edited"] is False


@pytest.mark.asyncio
async def test_put_text_unknown_chunk_404(client: AsyncClient, tmp_path, monkeypatch):
    await _chunk_one(client, tmp_path, monkeypatch, "te3")
    r = await client.put("/pipeline/episodes/te3/chunks/C999/text", json={"text": "x"})
    assert r.status_code == 404


def _scene(cid, n="01", mood="calm"):
    return {"scene_id": f"{cid}_S{n}", "location": "x", "characters": ["A"],
            "shot_type": "wide", "action": "act", "dialogue": [], "mood": mood}


async def _parse_one(client, tmp_path, cid, ep):
    # Simulate a completed parse by writing the original scenes file.
    doc = {"chunk_id": cid, "source_file": f"{ep}.txt", "model": "qwen3.5",
           "parsed_at": "2026-06-02T10:00:00Z", "scenes": [_scene(cid)]}
    (tmp_path / ep / f"{cid}_scenes.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")


@pytest.mark.asyncio
async def test_save_and_get_edited_scenes(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se1")
    await _parse_one(client, tmp_path, cid, "se1")

    r = await client.put(f"/pipeline/episodes/se1/chunks/{cid}/scenes",
                         json={"scenes": [_scene(cid, mood="ominous")]})
    assert r.status_code == 200
    assert r.json()["edited"] is True

    g = await client.get(f"/pipeline/episodes/se1/chunks/{cid}/scenes")
    assert g.json()["edited"] is True
    assert g.json()["scenes"][0]["mood"] == "ominous"


@pytest.mark.asyncio
async def test_put_scenes_unparsed_404(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se2")
    r = await client.put(f"/pipeline/episodes/se2/chunks/{cid}/scenes",
                         json={"scenes": [_scene(cid)]})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_put_scenes_invalid_body_422(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se3")
    await _parse_one(client, tmp_path, cid, "se3")
    r = await client.put(f"/pipeline/episodes/se3/chunks/{cid}/scenes",
                         json={"scenes": [{"scene_id": "x"}]})  # missing required fields
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_reset_edited_scenes(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se4")
    await _parse_one(client, tmp_path, cid, "se4")
    await client.put(f"/pipeline/episodes/se4/chunks/{cid}/scenes",
                    json={"scenes": [_scene(cid, mood="ominous")]})

    d = await client.delete(f"/pipeline/episodes/se4/chunks/{cid}/scenes/edited")
    assert d.status_code == 200
    assert d.json()["edited"] is False
    assert d.json()["scenes"][0]["mood"] == "calm"


@pytest.mark.asyncio
async def test_chunks_listing_reflects_edited_scene_count(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se5")
    await _parse_one(client, tmp_path, cid, "se5")  # 1 scene original
    await client.put(f"/pipeline/episodes/se5/chunks/{cid}/scenes",
                    json={"scenes": [_scene(cid), _scene(cid, n="02")]})  # 2 edited

    chunks = (await client.get("/pipeline/episodes/se5/chunks")).json()["chunks"]
    row = next(c for c in chunks if c["chunk_id"] == cid)
    assert row["scene_count"] == 2


@pytest.mark.asyncio
async def test_refine_text_target(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf1")
    fake = {"reply": "ok", "corrections": [{"find": "a", "replace": "b",
            "rationale": "r", "all_occurrences": True}]}
    with patch("animatory.pipeline_router.proofread_text", new_callable=AsyncMock, return_value=fake):
        r = await client.post(f"/pipeline/episodes/rf1/chunks/{cid}/refine",
                              json={"messages": [{"role": "user", "content": "fix"}], "target": "text"})
    assert r.status_code == 200
    assert r.json()["corrections"][0]["replace"] == "b"


@pytest.mark.asyncio
async def test_refine_scenes_target(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf2")
    await _parse_one(client, tmp_path, cid, "rf2")
    fake = {"reply": "ok", "proposals": [{"scene_id": f"{cid}_S01",
            "changes": {"mood": "dark"}, "rationale": "r"}]}
    with patch("animatory.pipeline_router.refine_scenes", new_callable=AsyncMock, return_value=fake):
        r = await client.post(f"/pipeline/episodes/rf2/chunks/{cid}/refine",
                              json={"messages": [{"role": "user", "content": "darker"}], "target": "scenes"})
    assert r.status_code == 200
    assert r.json()["proposals"][0]["changes"]["mood"] == "dark"


@pytest.mark.asyncio
async def test_refine_scenes_target_unparsed_404(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf3")
    r = await client.post(f"/pipeline/episodes/rf3/chunks/{cid}/refine",
                          json={"messages": [{"role": "user", "content": "x"}], "target": "scenes"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_refine_llm_failure_502(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf4")
    with patch("animatory.pipeline_router.proofread_text", new_callable=AsyncMock,
               side_effect=ValueError("could not reach Qwen")):
        r = await client.post(f"/pipeline/episodes/rf4/chunks/{cid}/refine",
                              json={"messages": [{"role": "user", "content": "x"}], "target": "text"})
    assert r.status_code == 502
