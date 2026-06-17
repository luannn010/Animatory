# tests/test_pipeline_api.py
from __future__ import annotations
import io, json
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock
from animatory.pipeline_router import SceneModel, SceneDialogueModel

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
async def test_chat_stream_relays_engine_events(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "ch1")

    async def fake_stream(*args, **kwargs):
        yield {"event": "reply", "data": {"delta": "hi"}}
        yield {"event": "done", "data": {}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream), \
         patch("animatory.pipeline_router.generate_title", new_callable=AsyncMock, return_value="T"):
        r = await client.post(
            f"/pipeline/episodes/ch1/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "hi", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    body = r.text
    assert "event: session" in body
    assert "event: reply" in body
    assert "event: done" in body


@pytest.mark.asyncio
async def test_chat_stream_unknown_chunk_404(client: AsyncClient, tmp_path, monkeypatch):
    await _chunk_one(client, tmp_path, monkeypatch, "ch2")
    r = await client.post(
        "/pipeline/episodes/ch2/chunks/C999/chat/stream",
        json={"session_id": None, "message": "hi", "thinking": False, "mentions": {"scenes": [], "raw": False}},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_chat_stream_drops_foreign_scene_mentions(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "ch3")
    await _parse_one(client, tmp_path, cid, "ch3")
    captured = {}

    async def fake_stream(*args, **kwargs):
        captured["mentioned"] = kwargs.get("mentioned_scenes", [])
        yield {"event": "done", "data": {}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream), \
         patch("animatory.pipeline_router.generate_title", new_callable=AsyncMock, return_value="T"):
        await client.post(
            f"/pipeline/episodes/ch3/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "x", "thinking": False,
                  "mentions": {"scenes": [f"{cid}_S01", "OTHER_S09"], "raw": False}},
        )
    ids = [s["scene_id"] for s in captured["mentioned"]]
    assert ids == [f"{cid}_S01"]


@pytest.mark.asyncio
async def test_chat_stream_persists_turns_and_titles(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "st1")

    async def fake_stream(*args, **kwargs):
        yield {"event": "reply", "data": {"delta": "hello"}}
        yield {"event": "usage", "data": {"prompt_tokens": 42, "total_tokens": 50, "context_limit": 32768, "skipped_mentions": []}}
        yield {"event": "done", "data": {}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream), \
         patch("animatory.pipeline_router.generate_title", new_callable=AsyncMock, return_value="First Title"):
        r = await client.post(
            f"/pipeline/episodes/st1/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "hi", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
    body = r.text
    assert "event: session" in body
    assert "event: title" in body
    assert "First Title" in body

    sessions = (await client.get(f"/pipeline/episodes/st1/chunks/{cid}/chat/sessions")).json()
    assert len(sessions) == 1
    sid = sessions[0]["session_id"]
    assert sessions[0]["title"] == "First Title"
    assert sessions[0]["token_count"] == 42
    msgs = (await client.get(f"/pipeline/episodes/st1/chunks/{cid}/chat/sessions/{sid}")).json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["content"] == "hello"


@pytest.mark.asyncio
async def test_chat_stream_second_turn_no_retitle(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "st2")

    async def fake_stream(*args, **kwargs):
        yield {"event": "reply", "data": {"delta": "ok"}}
        yield {"event": "done", "data": {}}

    titler_calls = {"n": 0}
    async def fake_title(*args, **kwargs):
        titler_calls["n"] += 1
        return "Title"

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream), \
         patch("animatory.pipeline_router.generate_title", side_effect=fake_title):
        await client.post(
            f"/pipeline/episodes/st2/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "one", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
        sid = (await client.get(f"/pipeline/episodes/st2/chunks/{cid}/chat/sessions")).json()[0]["session_id"]
        r2 = await client.post(
            f"/pipeline/episodes/st2/chunks/{cid}/chat/stream",
            json={"session_id": sid, "message": "two", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
    assert "event: title" not in r2.text
    assert titler_calls["n"] == 1


@pytest.mark.asyncio
async def test_chat_stream_unknown_session_404(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "st3")
    r = await client.post(
        f"/pipeline/episodes/st3/chunks/{cid}/chat/stream",
        json={"session_id": "nope", "message": "hi", "thinking": False, "mentions": {"scenes": [], "raw": False}},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_chat_store_wired_into_app(client: AsyncClient):
    # The app exposes a chat_store on state after lifespan startup.
    from animatory.server import app
    assert hasattr(app.state, "chat_store")
    assert app.state.chat_store is not None


@pytest.mark.asyncio
async def test_session_crud(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "cs1")
    base = f"/pipeline/episodes/cs1/chunks/{cid}/chat/sessions"

    created = (await client.post(base)).json()
    sid = created["session_id"]
    assert created["title"] is None and created["message_count"] == 0

    listed = (await client.get(base)).json()
    assert any(s["session_id"] == sid for s in listed)

    got = (await client.get(f"{base}/{sid}")).json()
    assert got["session"]["session_id"] == sid
    assert got["messages"] == []

    renamed = (await client.patch(f"{base}/{sid}", json={"title": "Renamed"})).json()
    assert renamed["title"] == "Renamed"

    assert (await client.delete(f"{base}/{sid}")).status_code == 200
    assert (await client.get(f"{base}/{sid}")).status_code == 404


@pytest.mark.asyncio
async def test_session_get_unknown_404(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "cs2")
    r = await client.get(f"/pipeline/episodes/cs2/chunks/{cid}/chat/sessions/does-not-exist")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_chat_stream_error_persists_nothing(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se9")

    async def fake_stream(*args, **kwargs):
        yield {"event": "error", "data": {"detail": "qwen down"}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream), \
         patch("animatory.pipeline_router.generate_title", new_callable=AsyncMock, return_value="T"):
        r = await client.post(
            f"/pipeline/episodes/se9/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "hi", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
    assert "event: error" in r.text
    # A session was created (session event/id), but NO turns persisted on error.
    sessions = (await client.get(f"/pipeline/episodes/se9/chunks/{cid}/chat/sessions")).json()
    assert len(sessions) == 1
    sid = sessions[0]["session_id"]
    msgs = (await client.get(f"/pipeline/episodes/se9/chunks/{cid}/chat/sessions/{sid}")).json()["messages"]
    assert msgs == []  # neither user nor assistant turn persisted


@pytest.mark.asyncio
async def test_chat_stream_no_duplicate_user_on_retry(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se10")

    calls = {"n": 0}
    async def fake_stream(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            yield {"event": "error", "data": {"detail": "transient"}}
        else:
            yield {"event": "reply", "data": {"delta": "ok"}}
            yield {"event": "done", "data": {}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream), \
         patch("animatory.pipeline_router.generate_title", new_callable=AsyncMock, return_value="T"):
        # turn 1 errors (nothing persisted)
        await client.post(
            f"/pipeline/episodes/se10/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "hello", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
        sid = (await client.get(f"/pipeline/episodes/se10/chunks/{cid}/chat/sessions")).json()[0]["session_id"]
        # retry the SAME message on the SAME session → succeeds
        await client.post(
            f"/pipeline/episodes/se10/chunks/{cid}/chat/stream",
            json={"session_id": sid, "message": "hello", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
    msgs = (await client.get(f"/pipeline/episodes/se10/chunks/{cid}/chat/sessions/{sid}")).json()["messages"]
    # exactly one user turn + one assistant turn — no orphan from the failed attempt
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"] == "hello"


def test_scene_model_defaults_narration_and_optional_emotion():
    # Old-shaped scene (no narration / emotion) still validates.
    s = SceneModel(
        scene_id="C001_S01",
        location="Hall",
        characters=["A"],
        shot_type="wide",
        action="x",
        dialogue=[{"character": "A", "line": "hi"}],
        mood="tense",
    )
    assert s.narration == []
    assert s.dialogue[0].emotion is None
    assert s.dialogue[0].intensity is None


def test_scene_model_accepts_enriched_fields():
    s = SceneModel(
        scene_id="C001_S01",
        location="Hall",
        characters=["A"],
        shot_type="wide",
        action="x",
        dialogue=[{"character": "A", "line": "hi", "emotion": "angry", "intensity": "high"}],
        mood="tense",
        narration=["Đêm xuống."],
    )
    assert s.narration == ["Đêm xuống."]
    assert s.dialogue[0].emotion == "angry"
    assert s.dialogue[0].intensity == "high"


async def _chunk_episode(client, tmp_path, monkeypatch, ep="enttest"):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": (f"{ep}.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post(f"/pipeline/chunk?episode_id={ep}", files=files)
    assert r.status_code == 200
    return ep


@pytest.mark.asyncio
async def test_entities_get_empty_then_put_round_trip(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch)

    r = await client.get(f"/pipeline/episodes/{ep}/entities")
    assert r.status_code == 200
    assert r.json()["characters"] == []

    body = {
        "characters": [{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
        "locations": [{"canonical": "Cao's Palace", "aliases": []}],
    }
    r = await client.put(f"/pipeline/episodes/{ep}/entities", json=body)
    assert r.status_code == 200
    assert r.json()["characters"][0]["canonical"] == "Đại Càn"

    r = await client.get(f"/pipeline/episodes/{ep}/entities")
    assert r.json()["characters"][0]["aliases"] == ["đại cản"]


@pytest.mark.asyncio
async def test_entities_round_trips_descriptions_and_flips_generated(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch)

    # Seed a machine-generated description on disk (generated: True).
    machine = {
        "characters": [{
            "canonical": "Từ An", "aliases": [],
            "appears_in": ["C001_S01"],
            "description": {"summary": "a censor", "appearance": "lean", "attire": "robes",
                            "age_build": "young", "palette": "black"},
            "voice": {"register": "low", "tone": "dry", "pace": "measured",
                      "dominant_emotion": "mocking", "dominant_intensity": "medium", "line_count": 3},
            "generated": True,
        }],
        "locations": [{"canonical": "Phòng", "aliases": [],
                       "description": {"summary": "", "setting": "silk", "lighting": "dim",
                                       "time_variants": ["night"]}, "generated": True}],
    }
    r = await client.put(f"/pipeline/episodes/{ep}/entities", json=machine)
    assert r.status_code == 200
    got = r.json()["characters"][0]
    assert got["description"]["appearance"] == "lean"      # structured block round-trips
    assert got["voice"]["register"] == "low"
    assert got["generated"] is True                         # unchanged → stays machine-owned

    # Now a human edits the appearance: generated must flip to False.
    edited = {**machine}
    edited["characters"] = [{**machine["characters"][0],
                             "description": {**machine["characters"][0]["description"],
                                             "appearance": "tall and scarred"}}]
    r = await client.put(f"/pipeline/episodes/{ep}/entities", json=edited)
    assert r.json()["characters"][0]["generated"] is False  # edit detected

    r = await client.get(f"/pipeline/episodes/{ep}/entities")
    c = r.json()["characters"][0]
    assert c["description"]["appearance"] == "tall and scarred"
    assert c["generated"] is False


@pytest.mark.asyncio
async def test_entities_404_for_unknown_episode(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.get("/pipeline/episodes/nope/entities")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_voice_profiles_route_aggregates_scenes(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="vptest")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    (ep_dir / f"{cid}_scenes.json").write_text(_json.dumps({
        "chunk_id": cid, "scenes": [
            {"scene_id": f"{cid}_S01", "dialogue": [
                {"character": "Tư An", "line": "x", "emotion": "angry"}]}]
    }), encoding="utf-8")

    r = await client.get(f"/pipeline/episodes/{ep}/voice-profiles")
    assert r.status_code == 200
    profiles = r.json()["profiles"]
    assert profiles[0]["character"] == "Tư An"
    assert profiles[0]["dominant_emotion"] == "angry"


def _qwen_resp(content: str):
    m = MagicMock()
    m.raise_for_status = MagicMock()
    m.json.return_value = {"choices": [{"message": {"content": content}}]}
    return m


@pytest.mark.asyncio
async def test_reparse_route_returns_scene(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rptest")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    sid = f"{cid}_S01"
    (ep_dir / f"{cid}_scenes.json").write_text(_json.dumps({"chunk_id": cid, "scenes": [
        {"scene_id": sid, "location": "L", "characters": ["A"], "shot_type": "wide",
         "action": "old", "dialogue": [], "narration": [], "mood": "m"}]}), encoding="utf-8")

    # Reparse uses the beats-locator contract: the model returns anchors (not prose)
    # and code lifts the action verbatim from the chunk source. Anchor into TINY_TXT
    # ("Sentence one. Sentence two. " repeated); meta fields come from the model.
    returned = {"scene_id": sid, "location": "L2", "characters": ["A"], "shot_type": "medium",
                "mood": "calm",
                "beats": [{"type": "action", "start_anchor": "Sentence one.",
                           "end_anchor": "Sentence two."}]}
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_qwen_resp(_json.dumps(returned)))
        MockClient.return_value = instance
        r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{sid}/reparse")

    assert r.status_code == 200
    body = r.json()
    assert body["scene"]["scene_id"] == sid
    assert body["scene"]["location"] == "L2"           # meta carried from the model
    assert body["scene"]["mood"] == "calm"
    assert "Sentence one." in body["scene"]["action"]  # action lifted from source


@pytest.mark.asyncio
async def test_reparse_route_404_unknown_scene(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rp404")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    (ep_dir / f"{cid}_scenes.json").write_text(
        _json.dumps({"chunk_id": cid, "scenes": []}), encoding="utf-8")

    r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/NOPE_S99/reparse")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_reparse_route_409_when_not_parsed(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rp409")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{cid}_S01/reparse")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_reparse_route_503_when_chat_down(client, tmp_path, monkeypatch):
    """When the chat model is unreachable and can't be woken, reparse fails fast with 503."""
    monkeypatch.setenv("CHAT_PREFLIGHT", "1")
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rpdown")
    ep_dir = tmp_path / ep
    manifest = json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    sid = f"{cid}_S01"
    (ep_dir / f"{cid}_scenes.json").write_text(json.dumps({"chunk_id": cid, "scenes": [
        {"scene_id": sid, "location": "L", "characters": [], "shot_type": "wide",
         "action": "old", "dialogue": [], "narration": [], "mood": "m"}]}), encoding="utf-8")

    async def _down(endpoint, timeout_s):
        return False

    monkeypatch.setattr("animatory.scene_parser._chat_reachable", _down)
    monkeypatch.setattr("animatory.zimage.brain.BrainClient.wake", lambda self, model=None: False)

    r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{sid}/reparse")
    assert r.status_code == 503
    assert "not reachable" in r.json()["detail"]


@pytest.mark.asyncio
async def test_scene_source_route_returns_match(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="srctest")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    sid = f"{cid}_S01"
    # Edited text is preferred by the route — write known content there.
    (ep_dir / f"{cid}.edited.txt").write_text(
        "Dòng đầu không khớp.\nTu An chạy trốn khỏi phủ công chúa.\nDòng cuối.",
        encoding="utf-8")
    (ep_dir / f"{cid}_scenes.json").write_text(_json.dumps({"chunk_id": cid, "scenes": [
        {"scene_id": sid, "location": "L", "characters": [], "shot_type": "wide",
         "action": "Tu An chạy trốn khỏi phủ công chúa.", "dialogue": [], "narration": [], "mood": "m"}]}),
        encoding="utf-8")

    r = await client.get(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{sid}/source")
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["line_start"] == 1 and body["line_end"] == 1
    assert "Tu An chạy trốn" in body["excerpt"]


@pytest.mark.asyncio
async def test_scene_source_route_404_unknown_scene(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="src404")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    (ep_dir / f"{cid}_scenes.json").write_text(
        _json.dumps({"chunk_id": cid, "scenes": []}), encoding="utf-8")
    r = await client.get(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/NOPE_S99/source")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_scene_source_route_409_when_not_parsed(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="src409")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    r = await client.get(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{cid}_S01/source")
    assert r.status_code == 409
