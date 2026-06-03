# Chat Engine v2 — A2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat server-authoritative and persistent: turns live in SQLite organized into named sessions you can resume, browse, rename, delete, and start fresh.

**Architecture:** A new `animatory/chat_store.py` (aiosqlite, mirroring `run_store.py`) persists sessions + messages, wired into `app.state.chat_store`. The `/chat/stream` route changes from accepting a full transcript to `{session_id?, message}` — it loads history, streams via the unchanged A1 engine, persists the user + assistant turns, and auto-titles the first exchange. Session CRUD routes + a frontend session switcher complete it.

**Tech Stack:** Python 3.11 / FastAPI / aiosqlite / sse-starlette / pytest (backend); React 18 / TypeScript / Tailwind / Vitest (frontend).

**Spec:** [`docs/superpowers/specs/2026-06-04-chat-engine-v2-a2-design.md`](../specs/2026-06-04-chat-engine-v2-a2-design.md)

---

## File Structure

**Backend**
- Create `animatory/chat_store.py` — `ChatStore` + `InMemoryChatStore` (sessions/messages CRUD).
- Modify `animatory/server.py` — wire `app.state.chat_store` in the lifespan.
- Modify `animatory/chat_engine.py` — add `generate_title()`.
- Modify `animatory/pipeline_router.py` — session CRUD routes; rewrite `chat_stream` to be server-authoritative.
- Create `tests/test_chat_store.py`; extend `tests/test_pipeline_api.py`; extend `tests/test_chat_engine.py`.

**Frontend**
- Modify `frontend/src/api/chat.ts` — `streamChat` body `{session_id, message}`; `onSession`/`onTitle`; session CRUD funcs + types.
- Modify `frontend/src/components/refine/RefineChat.tsx` — session switcher, rename, delete, New chat, `/clear`, tool-count footnote.
- Modify `frontend/src/studio/views/ChapterView.tsx` — resume latest, server-authoritative `runTurn`, session management.
- Modify `frontend/src/api/chat.test.ts`.

**Conventions:** backend tests use the `client` fixture + `DB_PATH=:memory:` (from `tests/conftest.py`); LLM always mocked. Frontend: API only via `src/api/*`; one accent `#3772cf`; run `ui-taste` before JSX.

---

## Task 1: `chat_store.py`

**Files:**
- Create: `animatory/chat_store.py`
- Test: `tests/test_chat_store.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_store.py
from __future__ import annotations
import pytest
from animatory.chat_store import InMemoryChatStore


@pytest.fixture
async def store():
    s = InMemoryChatStore()
    await s.init()
    return s


@pytest.mark.asyncio
async def test_create_and_list_newest_first(store):
    a = await store.create_session("ep1", "C001", now="2026-06-04T00:00:01Z")
    b = await store.create_session("ep1", "C001", now="2026-06-04T00:00:02Z")
    sessions = await store.list_sessions("ep1", "C001")
    assert [s["session_id"] for s in sessions] == [b["session_id"], a["session_id"]]
    assert sessions[0]["message_count"] == 0
    assert sessions[0]["title"] is None


@pytest.mark.asyncio
async def test_append_messages_and_get(store):
    s = await store.create_session("ep1", "C001", now="2026-06-04T00:00:01Z")
    sid = s["session_id"]
    await store.append_message(sid, "user", "hi", None, now="2026-06-04T00:00:02Z")
    await store.append_message(sid, "assistant", "hello", [{"kind": "scene_edits", "payload": {"scene_id": "C001_S01"}}], now="2026-06-04T00:00:03Z")
    msgs = await store.get_messages(sid)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["tool_calls"][0]["kind"] == "scene_edits"
    sess = await store.get_session(sid)
    assert sess["message_count"] == 2
    assert sess["updated_at"] == "2026-06-04T00:00:03Z"  # bumped by append


@pytest.mark.asyncio
async def test_latest_title_tokens_and_delete(store):
    s1 = await store.create_session("ep1", "C001", now="2026-06-04T00:00:01Z")
    s2 = await store.create_session("ep1", "C001", now="2026-06-04T00:00:02Z")
    assert (await store.latest_session("ep1", "C001"))["session_id"] == s2["session_id"]

    await store.set_title(s1["session_id"], "My Chat", now="2026-06-04T00:00:05Z")
    await store.set_token_count(s1["session_id"], 1234, now="2026-06-04T00:00:06Z")
    got = await store.get_session(s1["session_id"])
    assert got["title"] == "My Chat"
    assert got["token_count"] == 1234

    await store.append_message(s1["session_id"], "user", "x", None, now="2026-06-04T00:00:07Z")
    await store.delete_session(s1["session_id"])
    assert await store.get_session(s1["session_id"]) is None
    assert await store.get_messages(s1["session_id"]) == []
    assert [s["session_id"] for s in await store.list_sessions("ep1", "C001")] == [s2["session_id"]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'animatory.chat_store'`

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/chat_store.py
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager

import aiosqlite

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id   TEXT PRIMARY KEY,
    episode_id   TEXT NOT NULL,
    chunk_id     TEXT NOT NULL,
    title        TEXT,
    token_count  INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    role         TEXT NOT NULL,
    content      TEXT NOT NULL,
    tool_calls   TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_chunk ON chat_sessions(episode_id, chunk_id, updated_at);
"""


def _session_dict(row: tuple) -> dict:
    return {
        "session_id": row[0], "episode_id": row[1], "chunk_id": row[2],
        "title": row[3], "token_count": row[4], "created_at": row[5],
        "updated_at": row[6], "message_count": row[7],
    }


class ChatStore:
    """File-backed session/message store (mirrors run_store.RunStore)."""

    def __init__(self, db_path: str = "animatory.db") -> None:
        self._db_path = db_path

    @asynccontextmanager
    async def _connect(self):
        db = await aiosqlite.connect(self._db_path)
        try:
            yield db
        finally:
            await db.close()

    async def init(self) -> None:
        async with self._connect() as db:
            await db.executescript(_CREATE_SQL)
            await db.commit()

    async def create_session(self, episode_id: str, chunk_id: str, *, now: str) -> dict:
        sid = str(uuid.uuid4())
        async with self._connect() as db:
            await db.execute(
                "INSERT INTO chat_sessions (session_id, episode_id, chunk_id, title, token_count, created_at, updated_at)"
                " VALUES (?, ?, ?, NULL, 0, ?, ?)",
                (sid, episode_id, chunk_id, now, now),
            )
            await db.commit()
        return {"session_id": sid, "episode_id": episode_id, "chunk_id": chunk_id,
                "title": None, "token_count": 0, "created_at": now, "updated_at": now,
                "message_count": 0}

    async def list_sessions(self, episode_id: str, chunk_id: str) -> list[dict]:
        sql = (
            "SELECT s.session_id, s.episode_id, s.chunk_id, s.title, s.token_count, s.created_at, s.updated_at,"
            " (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.session_id)"
            " FROM chat_sessions s WHERE s.episode_id = ? AND s.chunk_id = ?"
            " ORDER BY s.updated_at DESC, s.session_id DESC"
        )
        async with self._connect() as db:
            async with db.execute(sql, (episode_id, chunk_id)) as cur:
                rows = await cur.fetchall()
        return [_session_dict(r) for r in rows]

    async def latest_session(self, episode_id: str, chunk_id: str) -> dict | None:
        sessions = await self.list_sessions(episode_id, chunk_id)
        return sessions[0] if sessions else None

    async def get_session(self, session_id: str) -> dict | None:
        sql = (
            "SELECT s.session_id, s.episode_id, s.chunk_id, s.title, s.token_count, s.created_at, s.updated_at,"
            " (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.session_id)"
            " FROM chat_sessions s WHERE s.session_id = ?"
        )
        async with self._connect() as db:
            async with db.execute(sql, (session_id,)) as cur:
                row = await cur.fetchone()
        return _session_dict(row) if row else None

    async def get_messages(self, session_id: str) -> list[dict]:
        sql = "SELECT id, role, content, tool_calls, created_at FROM chat_messages WHERE session_id = ? ORDER BY id"
        async with self._connect() as db:
            async with db.execute(sql, (session_id,)) as cur:
                rows = await cur.fetchall()
        return [
            {"id": r[0], "role": r[1], "content": r[2],
             "tool_calls": json.loads(r[3]) if r[3] else [], "created_at": r[4]}
            for r in rows
        ]

    async def append_message(self, session_id: str, role: str, content: str,
                             tool_calls: list[dict] | None, *, now: str) -> None:
        tc = json.dumps(tool_calls, ensure_ascii=False) if tool_calls else None
        async with self._connect() as db:
            await db.execute(
                "INSERT INTO chat_messages (session_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, role, content, tc, now),
            )
            await db.execute("UPDATE chat_sessions SET updated_at = ? WHERE session_id = ?", (now, session_id))
            await db.commit()

    async def set_title(self, session_id: str, title: str, *, now: str) -> None:
        async with self._connect() as db:
            await db.execute("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE session_id = ?",
                             (title, now, session_id))
            await db.commit()

    async def set_token_count(self, session_id: str, n: int, *, now: str) -> None:
        async with self._connect() as db:
            await db.execute("UPDATE chat_sessions SET token_count = ?, updated_at = ? WHERE session_id = ?",
                             (n, now, session_id))
            await db.commit()

    async def delete_session(self, session_id: str) -> None:
        async with self._connect() as db:
            await db.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM chat_sessions WHERE session_id = ?", (session_id,))
            await db.commit()


class InMemoryChatStore(ChatStore):
    """Single-connection in-memory variant for tests (mirrors InMemoryRunStore)."""

    def __init__(self) -> None:
        super().__init__(db_path=":memory:")
        self._conn: aiosqlite.Connection | None = None

    async def init(self) -> None:
        self._conn = await aiosqlite.connect(":memory:")
        await self._conn.executescript(_CREATE_SQL)
        await self._conn.commit()

    @asynccontextmanager
    async def _connect(self):
        assert self._conn is not None, "Call init() first"
        yield self._conn  # shared connection; never closed per-call
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_store.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/chat_store.py tests/test_chat_store.py
git commit -m "feat(chat): SQLite chat session/message store"
```
(End commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.)

---

## Task 2: Wire `chat_store` into the app lifespan

**Files:**
- Modify: `animatory/server.py`
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_api.py  (append)
@pytest.mark.asyncio
async def test_chat_store_wired_into_app(client: AsyncClient):
    # The app exposes a chat_store on state after lifespan startup.
    from animatory.server import app
    assert hasattr(app.state, "chat_store")
    assert app.state.chat_store is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py::test_chat_store_wired_into_app -v`
Expected: FAIL — `AttributeError: ... has no attribute 'chat_store'`

- [ ] **Step 3: Write minimal implementation**

In `animatory/server.py`, add the import next to the run_store import:
```python
from animatory.chat_store import ChatStore, InMemoryChatStore
```

In the `lifespan` function, after the `studio_store` block and before `app.state.registry = registry`, add:
```python
    chat_store = InMemoryChatStore() if db_path == ":memory:" else ChatStore(db_path)
    await chat_store.init()
```
And add to the `app.state` assignments:
```python
    app.state.chat_store = chat_store
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py::test_chat_store_wired_into_app -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add animatory/server.py tests/test_pipeline_api.py
git commit -m "feat(chat): wire chat_store into app lifespan"
```

---

## Task 3: Session CRUD routes

**Files:**
- Modify: `animatory/pipeline_router.py`
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_pipeline_api.py  (append)
@pytest.mark.asyncio
async def test_session_crud(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "cs1")
    base = f"/pipeline/episodes/cs1/chunks/{cid}/chat/sessions"

    # create
    created = (await client.post(base)).json()
    sid = created["session_id"]
    assert created["title"] is None and created["message_count"] == 0

    # list
    listed = (await client.get(base)).json()
    assert any(s["session_id"] == sid for s in listed)

    # get (empty messages)
    got = (await client.get(f"{base}/{sid}")).json()
    assert got["session"]["session_id"] == sid
    assert got["messages"] == []

    # rename
    renamed = (await client.patch(f"{base}/{sid}", json={"title": "Renamed"})).json()
    assert renamed["title"] == "Renamed"

    # delete
    assert (await client.delete(f"{base}/{sid}")).status_code == 200
    assert (await client.get(f"{base}/{sid}")).status_code == 404


@pytest.mark.asyncio
async def test_session_get_unknown_404(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "cs2")
    r = await client.get(f"/pipeline/episodes/cs2/chunks/{cid}/chat/sessions/does-not-exist")
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py -k session_crud -v`
Expected: FAIL — `405` / `404` on create.

- [ ] **Step 3: Write minimal implementation**

In `animatory/pipeline_router.py`, confirm `Request` is imported (it is — used by the parse route). Add a request model near `ChatStreamRequest`:
```python
class RenameSessionRequest(BaseModel):
    title: str
```

Add a helper near the other helpers (after `_scenes_payload`):
```python
def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


async def _owned_session(request: Request, episode_id: str, chunk_id: str, session_id: str) -> dict:
    """Fetch a session and verify it belongs to this episode+chunk, else 404."""
    sess = await request.app.state.chat_store.get_session(session_id)
    if sess is None or sess["episode_id"] != episode_id or sess["chunk_id"] != chunk_id:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    return sess
```

Add the CRUD routes (after the `chat_stream` route):
```python
@router.get("/episodes/{episode_id}/chunks/{chunk_id}/chat/sessions")
async def list_chat_sessions(episode_id: str, chunk_id: str, request: Request):
    _chunk_meta(_processed_dir() / episode_id, chunk_id)
    return await request.app.state.chat_store.list_sessions(episode_id, chunk_id)


@router.post("/episodes/{episode_id}/chunks/{chunk_id}/chat/sessions")
async def create_chat_session(episode_id: str, chunk_id: str, request: Request):
    _chunk_meta(_processed_dir() / episode_id, chunk_id)
    return await request.app.state.chat_store.create_session(episode_id, chunk_id, now=_now())


@router.get("/episodes/{episode_id}/chunks/{chunk_id}/chat/sessions/{session_id}")
async def get_chat_session(episode_id: str, chunk_id: str, session_id: str, request: Request):
    _chunk_meta(_processed_dir() / episode_id, chunk_id)
    sess = await _owned_session(request, episode_id, chunk_id, session_id)
    messages = await request.app.state.chat_store.get_messages(session_id)
    return {"session": sess, "messages": messages}


@router.patch("/episodes/{episode_id}/chunks/{chunk_id}/chat/sessions/{session_id}")
async def rename_chat_session(episode_id: str, chunk_id: str, session_id: str,
                              body: RenameSessionRequest, request: Request):
    _chunk_meta(_processed_dir() / episode_id, chunk_id)
    await _owned_session(request, episode_id, chunk_id, session_id)
    await request.app.state.chat_store.set_title(session_id, body.title, now=_now())
    return await request.app.state.chat_store.get_session(session_id)


@router.delete("/episodes/{episode_id}/chunks/{chunk_id}/chat/sessions/{session_id}")
async def delete_chat_session(episode_id: str, chunk_id: str, session_id: str, request: Request):
    _chunk_meta(_processed_dir() / episode_id, chunk_id)
    await _owned_session(request, episode_id, chunk_id, session_id)
    await request.app.state.chat_store.delete_session(session_id)
    return {"ok": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py -k session -v`
Expected: PASS (2 new tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(pipeline): chat session CRUD routes"
```

---

## Task 4: `generate_title` in `chat_engine.py`

**Files:**
- Modify: `animatory/chat_engine.py`
- Test: `tests/test_chat_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_engine.py  (append; AsyncMock/patch/MagicMock already imported)
@pytest.mark.asyncio
async def test_generate_title_uses_llm():
    from animatory.chat_engine import generate_title
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"choices": [{"message": {"content": '"Bedroom Standoff"'}}]}
    with patch("animatory.chat_engine.httpx.AsyncClient") as MockClient:
        inst = AsyncMock()
        inst.__aenter__ = AsyncMock(return_value=inst)
        inst.__aexit__ = AsyncMock(return_value=False)
        inst.post = AsyncMock(return_value=resp)
        MockClient.return_value = inst
        title = await generate_title([{"role": "user", "content": "describe scene 1"}])
    assert title == "Bedroom Standoff"  # quotes stripped


@pytest.mark.asyncio
async def test_generate_title_falls_back_on_error():
    from animatory.chat_engine import generate_title
    import httpx
    with patch("animatory.chat_engine.httpx.AsyncClient") as MockClient:
        inst = AsyncMock()
        inst.__aenter__ = AsyncMock(return_value=inst)
        inst.__aexit__ = AsyncMock(return_value=False)
        inst.post = AsyncMock(side_effect=httpx.ConnectError("down"))
        MockClient.return_value = inst
        title = await generate_title([{"role": "user", "content": "Make the mood darker please and tighten dialogue everywhere"}])
    assert title == "Make the mood darker please and tighten d"  # first 40 chars of first user msg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_engine.py -k generate_title -v`
Expected: FAIL — `ImportError: cannot import name 'generate_title'`

- [ ] **Step 3: Write minimal implementation**

Append to `animatory/chat_engine.py`:
```python
async def generate_title(messages: list[dict], *, qwen_endpoint=None, model=None) -> str:
    """Short LLM-generated session title; falls back to the first user message."""
    first_user = next((m["content"] for m in messages if m.get("role") == "user"), "")
    fallback = first_user.strip()[:40] or "New chat"

    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))

    transcript = "\n".join(f"{m['role']}: {m['content']}" for m in messages[:4])
    prompt = (
        "Give a concise 3-5 word title for this conversation. "
        "Reply with ONLY the title — no quotes, no punctuation, no preamble.\n\n" + transcript
    )
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(f"{endpoint}/v1/chat/completions", json=payload)
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
        title = raw.strip().strip('"').strip("'").strip()
        title = title.splitlines()[0].strip()[:60] if title else ""
        return title or fallback
    except (httpx.HTTPError, KeyError, json.JSONDecodeError, IndexError) as exc:
        logger.warning("[chat] title generation failed -> %s; using fallback", repr(exc))
        return fallback
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_engine.py -v`
Expected: PASS (all chat_engine tests incl. 2 new)

- [ ] **Step 5: Commit**

```bash
git add animatory/chat_engine.py tests/test_chat_engine.py
git commit -m "feat(chat): generate_title with safe fallback"
```

---

## Task 5: Server-authoritative `chat_stream` route

**Files:**
- Modify: `animatory/pipeline_router.py`
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing tests**

First, **replace the three existing A1 `chat_stream` tests** — they send `{"messages": [...]}`, which the new model rejects (missing required `message` → 422). Any test that runs a full stream must also patch `generate_title` (the first exchange auto-titles, which would otherwise make a real network call). Replace them with:

```python
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
```

Then append the new persistence tests:

```python
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

    # The session now holds the user + assistant turns and the token count + title.
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
        # turn 1 (creates session, titles)
        r1 = await client.post(
            f"/pipeline/episodes/st2/chunks/{cid}/chat/stream",
            json={"session_id": None, "message": "one", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
        sid = [s["session_id"] for s in (await client.get(f"/pipeline/episodes/st2/chunks/{cid}/chat/sessions")).json()][0]
        # turn 2 (same session, must NOT retitle)
        r2 = await client.post(
            f"/pipeline/episodes/st2/chunks/{cid}/chat/stream",
            json={"session_id": sid, "message": "two", "thinking": False, "mentions": {"scenes": [], "raw": False}},
        )
    assert "event: title" in r1.text
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py -k chat_stream -v`
Expected: FAIL — request validation (no `message` field handling) / no `session` event / persistence assertions.

- [ ] **Step 3: Write minimal implementation**

In `animatory/pipeline_router.py`:

(a) Update the import to add `generate_title`:
```python
from animatory.chat_engine import stream_chat, generate_title
```

(b) Replace `ChatStreamRequest` (remove `messages`, add `session_id` + `message`):
```python
class ChatStreamRequest(BaseModel):
    session_id: str | None = None
    message: str
    thinking: bool = False
    mentions: ChatMentions = ChatMentions()
```
(`ChatTurnMessage` is no longer used by the stream route — leave it only if other code references it; otherwise delete it. Grep `ChatTurnMessage`; if unused, remove it.)

(c) Replace the entire `chat_stream` route with the server-authoritative version:
```python
@router.post("/episodes/{episode_id}/chunks/{chunk_id}/chat/stream")
async def chat_stream(episode_id: str, chunk_id: str, body: ChatStreamRequest, request: Request):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    store = request.app.state.chat_store

    # Resolve or create the session (scoped to this chunk).
    if body.session_id:
        await _owned_session(request, episode_id, chunk_id, body.session_id)
        session_id = body.session_id
    else:
        session_id = (await store.create_session(episode_id, chunk_id, now=_now()))["session_id"]

    # Context (unchanged from A1), scoped to this chunk.
    doc = _scenes_payload(ep_dir, chunk_id)
    all_scenes = doc.get("scenes", []) if doc else []
    valid_ids = {s["scene_id"] for s in all_scenes}
    scene_index = [
        {"scene_id": s["scene_id"], "location": s.get("location", ""), "characters": s.get("characters", [])}
        for s in all_scenes
    ]
    wanted = set(body.mentions.scenes) & valid_ids
    mentioned = [s for s in all_scenes if s["scene_id"] in wanted]
    raw_text = _text_payload(ep_dir, chunk_id, meta)["text"] if body.mentions.raw else None

    # Persist the user turn, then load the full history as the model's context.
    prior = await store.get_messages(session_id)
    is_first = len(prior) == 0
    await store.append_message(session_id, "user", body.message, None, now=_now())
    history = [{"role": m["role"], "content": m["content"]} for m in await store.get_messages(session_id)]

    async def gen():
        yield {"event": "session", "data": json.dumps({"session_id": session_id})}
        reply_parts: list[str] = []
        tool_calls: list[dict] = []
        prompt_tokens = 0
        errored = False
        async for ev in stream_chat(
            chunk_id=chunk_id, scene_index=scene_index, mentioned_scenes=mentioned,
            raw_text=raw_text, messages=history, thinking=body.thinking,
        ):
            etype = ev["event"]
            if etype == "done":
                continue  # we emit our own done after persistence
            if etype == "reply":
                reply_parts.append(ev["data"].get("delta", ""))
            elif etype == "tool":
                tool_calls.append({"kind": ev["data"]["kind"], "payload": ev["data"]["payload"]})
            elif etype == "usage":
                prompt_tokens = ev["data"].get("prompt_tokens", 0)
            yield {"event": etype, "data": json.dumps(ev["data"], ensure_ascii=False)}
            if etype == "error":
                errored = True
                break
        if errored:
            return  # user turn persisted; no assistant turn
        reply = "".join(reply_parts)
        await store.append_message(session_id, "assistant", reply, tool_calls or None, now=_now())
        if prompt_tokens:
            await store.set_token_count(session_id, prompt_tokens, now=_now())
        if is_first:
            title = await generate_title(history + [{"role": "assistant", "content": reply}])
            await store.set_title(session_id, title, now=_now())
            yield {"event": "title", "data": json.dumps({"title": title})}
        yield {"event": "done", "data": json.dumps({})}

    return EventSourceResponse(gen())
```

- [ ] **Step 4: Run tests to verify pass**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py -v`
Then the whole suite: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/ -q`
Expected: green (updated A1 chat_stream tests + new persistence tests).

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(pipeline): server-authoritative chat_stream with persistence + titles"
```

---

## Task 6: Frontend `chat.ts` — session API + new body/handlers

**Files:**
- Modify: `frontend/src/api/chat.ts`
- Modify: `frontend/src/api/chat.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the `streamChat` test body assertion to the new shape and add session-fn + new-event tests. Append/replace in `frontend/src/api/chat.test.ts`:

```ts
// frontend/src/api/chat.test.ts  (add to the existing describe blocks)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseSSE, streamChat, listSessions, createSession, getSession, renameSession, deleteSession } from './chat'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body, text: async () => JSON.stringify(body) })
}

afterEach(() => vi.unstubAllGlobals())

describe('session api', () => {
  it('createSession POSTs to the sessions route', async () => {
    const f = jsonResponse({ session_id: 's1', title: null })
    vi.stubGlobal('fetch', f)
    const s = await createSession('ep1', 'C001')
    expect(s.session_id).toBe('s1')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/chunks/C001/chat/sessions')
    expect(init.method).toBe('POST')
  })

  it('renameSession PATCHes title; deleteSession DELETEs', async () => {
    const f = jsonResponse({ session_id: 's1', title: 'X' })
    vi.stubGlobal('fetch', f)
    await renameSession('ep1', 'C001', 's1', 'X')
    expect(f.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(f.mock.calls[0][1].body).title).toBe('X')
    const d = jsonResponse({ ok: true })
    vi.stubGlobal('fetch', d)
    await deleteSession('ep1', 'C001', 's1')
    expect(d.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('streamChat A2 body + events', () => {
  function streamResponse(text: string): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() },
    })
    return { ok: true, status: 200, body: stream } as unknown as Response
  }

  it('sends session_id + message and dispatches session/title', async () => {
    const sse =
      'event: session\ndata: {"session_id":"s9"}\n\n' +
      'event: reply\ndata: {"delta":"hi"}\n\n' +
      'event: title\ndata: {"title":"T"}\n\n' +
      'event: done\ndata: {}\n\n'
    const f = vi.fn().mockResolvedValue(streamResponse(sse))
    vi.stubGlobal('fetch', f)
    const got: string[] = []
    await new Promise<void>(resolve => {
      streamChat('ep1', 'C001',
        { session_id: null, message: 'hi', thinking: false, mentions: { scenes: [], raw: false } },
        {
          onSession: id => got.push('session:' + id),
          onReply: d => got.push('reply:' + d),
          onTitle: t => got.push('title:' + t),
          onTool: () => {}, onUsage: () => {},
          onDone: () => { got.push('done'); resolve() },
          onError: () => { got.push('err'); resolve() },
        })
    })
    expect(got).toEqual(['session:s9', 'reply:hi', 'title:T', 'done'])
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ session_id: null, message: 'hi' })
  })
})
```

(Delete the old A1 `streamChat` dispatch test that used `{ messages: [...] }` — it's replaced by the A2 test above. Keep the `parseSSE` test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/chat.test.ts`
Expected: FAIL — `listSessions`/etc. not exported; body shape mismatch.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api/chat.ts`:

(a) Change the `ChatStreamHandlers` interface to add the two handlers:
```ts
export interface ChatStreamHandlers {
  onSession?(sessionId: string): void
  onTitle?(title: string): void
  onThinking?(delta: string): void
  onReply(delta: string): void
  onTool(kind: 'scene_edits' | 'text_corrections', payload: unknown): void
  onUsage(u: ChatUsage): void
  onDone(): void
  onError(detail: string): void
}
```

(b) In `dispatch`, add the two cases (before `default`):
```ts
    case 'session': h.onSession?.(String(d.session_id ?? '')); break
    case 'title': h.onTitle?.(String(d.title ?? '')); break
```

(c) Change `streamChat`'s `body` parameter type:
```ts
  body: { session_id: string | null; message: string; thinking: boolean; mentions: ChatMention },
```
(The fetch call body already does `JSON.stringify(body)` — no change there.)

(d) Append session types + functions and a shared base helper:
```ts
export interface ChatSessionMeta {
  session_id: string
  title: string | null
  token_count: number
  message_count: number
  updated_at: string
}
export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls: { kind: string; payload: unknown }[]
  created_at: string
}

function sessionsBase(episodeId: string, chunkId: string): string {
  return `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/chat/sessions`
}
async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw new Error(`${label} failed ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function listSessions(episodeId: string, chunkId: string): Promise<ChatSessionMeta[]> {
  return jsonOrThrow(await fetch(sessionsBase(episodeId, chunkId)), 'listSessions')
}
export async function createSession(episodeId: string, chunkId: string): Promise<ChatSessionMeta> {
  return jsonOrThrow(await fetch(sessionsBase(episodeId, chunkId), { method: 'POST' }), 'createSession')
}
export async function getSession(episodeId: string, chunkId: string, sessionId: string): Promise<{ session: ChatSessionMeta; messages: StoredMessage[] }> {
  return jsonOrThrow(await fetch(`${sessionsBase(episodeId, chunkId)}/${encodeURIComponent(sessionId)}`), 'getSession')
}
export async function renameSession(episodeId: string, chunkId: string, sessionId: string, title: string): Promise<ChatSessionMeta> {
  return jsonOrThrow(await fetch(`${sessionsBase(episodeId, chunkId)}/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
  }), 'renameSession')
}
export async function deleteSession(episodeId: string, chunkId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${sessionsBase(episodeId, chunkId)}/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteSession failed ${res.status}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/chat.test.ts && npx tsc -b --noEmit`
Expected: tests pass; tsc shows errors only in ChapterView/RefineChat (old streamChat body / handlers) — fixed in Tasks 7-8.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/chat.ts frontend/src/api/chat.test.ts
git commit -m "feat(frontend): chat session API + session/title stream events"
```

---

## Task 7: `RefineChat` — session switcher

**Files:**
- Rewrite: `frontend/src/components/refine/RefineChat.tsx`

> Run the `ui-taste` skill before writing JSX. One accent `#3772cf`/`#2c5cab`; tokens; focus-visible rings; restrained motion.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/refine/RefineChat.tsx
import { useMemo, useState } from 'react'
import type { ChatMention, ChatUsage, ChatSessionMeta } from '../../api/chat'
import { parseMentions } from './mentions'

export interface ChatDisplayMessage {
  role: 'user' | 'assistant'
  content: string
  toolCount?: number
}

interface Props {
  messages: ChatDisplayMessage[]
  streaming: boolean
  streamReply: string
  streamThinking: string
  thinkingEnabled: boolean
  usage: ChatUsage | null
  error: string
  sceneIds: string[]
  sessions: ChatSessionMeta[]
  activeSessionId: string | null
  onToggleThinking: () => void
  onSend: (text: string, mentions: ChatMention) => void
  onAbort: () => void
  onRetry: () => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
}

export function RefineChat(props: Props) {
  const {
    messages, streaming, streamReply, streamThinking, thinkingEnabled, usage, error,
    sceneIds, sessions, activeSessionId, onToggleThinking, onSend, onAbort, onRetry,
    onNewChat, onSelectSession, onRenameSession, onDeleteSession,
  } = props
  const [draft, setDraft] = useState('')
  const [showThoughts, setShowThoughts] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const activeTitle = sessions.find(s => s.session_id === activeSessionId)?.title ?? 'New chat'

  const trailing = /(^|\s)@(\w*)$/.exec(draft)
  const suggestions = useMemo(() => {
    if (!trailing) return [] as string[]
    const q = trailing[2].toLowerCase()
    const opts = ['raw', ...sceneIds.map((_, i) => `Scene${String(i + 1).padStart(2, '0')}`)]
    return opts.filter(o => o.toLowerCase().startsWith(q)).slice(0, 6)
  }, [trailing, sceneIds])

  function applySuggestion(s: string) { setDraft(d => d.replace(/@(\w*)$/, `@${s} `)) }
  function submit() {
    const text = draft.trim()
    if (!text || streaming) return
    if (text === '/clear') { onNewChat(); setDraft(''); return }
    onSend(text, parseMentions(text, sceneIds))
    setDraft('')
  }
  function startRename(s: ChatSessionMeta) { setRenamingId(s.session_id); setRenameDraft(s.title ?? '') }
  function commitRename() {
    if (renamingId && renameDraft.trim()) onRenameSession(renamingId, renameDraft.trim())
    setRenamingId(null)
  }

  const pct = usage && usage.context_limit > 0
    ? Math.min(100, Math.round((usage.prompt_tokens / usage.context_limit) * 100)) : 0
  const ctrl = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

  return (
    <div className="flex flex-col h-full rounded-lg border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
        <button
          type="button"
          onClick={() => setHistoryOpen(o => !o)}
          className={`flex items-center gap-1.5 text-sm font-semibold text-ink rounded-md transition-colors hover:text-steel ${ctrl}`}
        >
          {activeTitle}
          <span className="text-stone text-[10px]">{historyOpen ? '▲' : '▼'}</span>
        </button>
        <div className="flex items-center gap-3">
          {usage && <ContextRing pct={pct} label={`${usage.prompt_tokens} / ${usage.context_limit}`} />}
          <button type="button" onClick={onToggleThinking} disabled={streaming}
            className={`text-[11px] rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${ctrl} ` +
              (thinkingEnabled ? 'border-[#3772cf] text-[#3772cf]' : 'border-hairline text-steel hover:text-ink')}>
            Thinking {thinkingEnabled ? 'on' : 'off'}
          </button>
          <button type="button" onClick={onNewChat} disabled={streaming}
            className={`text-[11px] text-steel hover:text-ink disabled:opacity-40 transition-colors rounded-md ${ctrl}`}>
            New chat
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="border-b border-hairline max-h-48 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-stone">No saved chats yet.</p>
          ) : sessions.map(s => (
            <div key={s.session_id}
              className={'flex items-center gap-2 px-4 py-2 text-xs border-b border-hairline last:border-b-0 ' +
                (s.session_id === activeSessionId ? 'bg-surface' : '')}>
              {renamingId === s.session_id ? (
                <input autoFocus value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                  onBlur={commitRename}
                  className={`flex-1 rounded-md border border-hairline bg-canvas px-2 py-1 text-ink ${ctrl}`} />
              ) : (
                <button type="button" onClick={() => { onSelectSession(s.session_id); setHistoryOpen(false) }}
                  className={`flex-1 text-left truncate hover:text-ink transition-colors rounded-md ${ctrl} ` +
                    (s.session_id === activeSessionId ? 'text-ink font-medium' : 'text-steel')}>
                  {s.title ?? 'Untitled'} <span className="text-stone">· {s.message_count} msg</span>
                </button>
              )}
              <button type="button" onClick={() => startRename(s)} aria-label="Rename chat"
                className={`text-stone hover:text-ink transition-colors rounded-md px-1 ${ctrl}`}>Rename</button>
              <button type="button"
                onClick={() => { if (window.confirm('Delete this chat?')) onDeleteSession(s.session_id) }}
                aria-label="Delete chat"
                className={`text-stone hover:text-brand-error transition-colors rounded-md px-1 ${ctrl}`}>Delete</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !streaming ? (
          <p className="text-xs text-stone leading-relaxed">
            Ask about this chapter, or request a change. Tag context with <code className="text-steel">@Scene1</code> or <code className="text-steel">@raw</code>.
          </p>
        ) : (
          messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} toolCount={m.toolCount} />)
        )}
        {streaming && (
          <div className="space-y-2">
            {thinkingEnabled && streamThinking && (
              <div className="rounded-md border border-hairline bg-surface">
                <button onClick={() => setShowThoughts(s => !s)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] text-steel hover:text-ink transition-colors rounded-md ${ctrl}`}>
                  {showThoughts ? '▾' : '▸'} Thinking…
                </button>
                {showThoughts && (
                  <pre className="px-3 pb-2 text-[11px] text-stone whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{streamThinking}</pre>
                )}
              </div>
            )}
            <Bubble role="assistant" content={streamReply || '…'} />
          </div>
        )}
        {error && (
          <div className="text-xs text-brand-error">
            {error}{' '}
            <button onClick={onRetry} className={`underline hover:text-ink rounded-md ${ctrl}`}>Retry</button>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        {suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => applySuggestion(s)}
                className={`rounded-full border border-hairline px-2 py-0.5 text-[11px] text-steel hover:text-ink hover:border-[#3772cf] transition-colors ${ctrl}`}>
                @{s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={2} placeholder="Ask, request a change, or /clear… (@Scene1, @raw)"
            className={`flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink placeholder:text-stone ${ctrl}`} />
          {streaming ? (
            <button type="button" onClick={onAbort}
              className={`px-3 py-2 rounded-md border border-hairline text-steel text-xs hover:bg-surface transition-colors ${ctrl}`}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!draft.trim()}
              className={`px-3 py-2 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${ctrl}`}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, content, toolCount }: { role: 'user' | 'assistant'; content: string; toolCount?: number }) {
  return (
    <div className={role === 'user' ? 'text-right' : 'text-left'}>
      <span className={
        'inline-block rounded-md px-3 py-2 text-xs leading-snug max-w-[85%] text-left whitespace-pre-wrap ' +
        (role === 'user' ? 'bg-[#3772cf] text-white' : 'bg-surface text-ink border border-hairline')
      }>
        {content}
      </span>
      {role === 'assistant' && toolCount ? (
        <div className="text-[10px] text-stone mt-0.5">proposed {toolCount} edit{toolCount === 1 ? '' : 's'}</div>
      ) : null}
    </div>
  )
}

function ContextRing({ pct, label }: { pct: number; label: string }) {
  const r = 7, c = 2 * Math.PI * r
  const danger = pct >= 90
  return (
    <span title={`Context: ${label}`} className="inline-flex items-center" aria-label={`Context ${pct}%`}>
      <svg viewBox="0 0 18 18" className="w-4 h-4 -rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-hairline" />
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          stroke={danger ? '#d45656' : '#3772cf'} strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
    </span>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: errors only in `ChapterView.tsx` (old RefineChat props / message type) — fixed in Task 8. `RefineChat.tsx` itself clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/RefineChat.tsx
git commit -m "feat(frontend): RefineChat session switcher, rename, delete, /clear"
```

---

## Task 8: Wire `ChapterView` to sessions

**Files:**
- Modify: `frontend/src/studio/views/ChapterView.tsx`

> Run the `ui-taste` skill before touching JSX.

- [ ] **Step 1: Update imports + chat state**

Change the chat-api import and add session funcs:
```tsx
import {
  streamChat, listSessions, createSession, getSession, renameSession, deleteSession,
  type ChatMention, type ChatUsage, type ChatSessionMeta,
} from '../../api/chat'
import { RefineChat, type ChatDisplayMessage } from '../../components/refine/RefineChat'
```
Drop `type ChatMessage` from the `../../api/pipeline` import (the chat no longer uses it). Keep `PipelineScene`, `ScenePatch`, `TextCorrection`.

Replace the "Chat state" block with:
```tsx
  // Chat state
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([])
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamReply, setStreamReply] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [usage, setUsage] = useState<ChatUsage | null>(null)
  const [chatError, setChatError] = useState('')
  const chatAbortRef = useRef<{ abort(): void } | null>(null)
  const lastTurnRef = useRef<{ text: string; mentions: ChatMention } | null>(null)
  const streamReplyRef = useRef('')
```

- [ ] **Step 2: Add a session-loading effect (after the existing load effect)**

```tsx
  // Resume the latest session for this chunk on open.
  useEffect(() => {
    let alive = true
    listSessions(episodeId, chunkId).then(async list => {
      if (!alive) return
      setSessions(list)
      if (list.length > 0) {
        const { session, messages: stored } = await getSession(episodeId, chunkId, list[0].session_id)
        if (!alive) return
        setActiveSessionId(session.session_id)
        setMessages(stored.map(m => ({ role: m.role, content: m.content, toolCount: m.tool_calls.length })))
        setUsage({ prompt_tokens: session.token_count, total_tokens: session.token_count, context_limit: 32768, skipped_mentions: [] })
      }
    }).catch(() => { /* no sessions yet */ })
    return () => { alive = false }
  }, [episodeId, chunkId])
```

- [ ] **Step 3: Replace the chat handlers (the `--- Chat (streaming) ---` block) with the session-aware version**

```tsx
  // --- Chat (streaming, server-authoritative) ---
  async function refreshSessions() {
    try { setSessions(await listSessions(episodeId, chunkId)) } catch { /* ignore */ }
  }
  function runTurn(text: string, mentions: ChatMention) {
    lastTurnRef.current = { text, mentions }
    setMessages(m => [...m, { role: 'user', content: text }])
    streamReplyRef.current = ''
    setStreaming(true); setChatError(''); setStreamReply(''); setStreamThinking(''); setSkipped(0)
    let reply = ''
    let toolCount = 0
    const handle = streamChat(
      episodeId, chunkId,
      { session_id: activeSessionId, message: text, thinking: thinkingEnabled, mentions },
      {
        onSession: id => setActiveSessionId(id),
        onTitle: () => { refreshSessions() },
        onThinking: d => setStreamThinking(t => t + d),
        onReply: d => { reply += d; streamReplyRef.current = reply; setStreamReply(reply) },
        onTool: (kind, payload) => {
          toolCount += 1
          if (kind === 'scene_edits') {
            const p = payload as ScenePatch
            if (scenes.some(s => s.scene_id === p.scene_id)) setProposals(prev => ({ ...prev, [p.scene_id]: p }))
            else setSkipped(n => n + 1)
          } else {
            const { corrections: cs } = payload as { corrections: TextCorrection[] }
            setCorrections(cs ?? [])
          }
        },
        onUsage: u => setUsage(u),
        onDone: () => {
          setStreaming(false)
          setMessages(m => reply ? [...m, { role: 'assistant', content: reply, toolCount }] : m)
          setStreamReply(''); setStreamThinking('')
          refreshSessions()
        },
        onError: detail => { setStreaming(false); setChatError(detail) },
      },
    )
    chatAbortRef.current = handle
  }
  function onSend(text: string, mentions: ChatMention) { if (!streaming) runTurn(text, mentions) }
  function onAbortChat() {
    chatAbortRef.current?.abort()
    const partial = streamReplyRef.current
    streamReplyRef.current = ''
    setStreaming(false)
    setMessages(m => partial ? [...m, { role: 'assistant', content: partial }] : m)
    setStreamReply(''); setStreamThinking('')
  }
  function onRetryChat() {
    const last = lastTurnRef.current
    if (!last) return
    // Drop the optimistic trailing user bubble before re-running (server already stored it once).
    setMessages(m => m[m.length - 1]?.role === 'user' ? m.slice(0, -1) : m)
    runTurn(last.text, last.mentions)
  }
  async function onNewChat() {
    chatAbortRef.current?.abort()
    setStreaming(false); setStreamReply(''); setStreamThinking(''); setChatError(''); setUsage(null)
    const s = await createSession(episodeId, chunkId)
    setActiveSessionId(s.session_id); setMessages([])
    refreshSessions()
  }
  async function onSelectSession(id: string) {
    if (streaming) return
    const { session, messages: stored } = await getSession(episodeId, chunkId, id)
    setActiveSessionId(session.session_id)
    setMessages(stored.map(m => ({ role: m.role, content: m.content, toolCount: m.tool_calls.length })))
    setUsage({ prompt_tokens: session.token_count, total_tokens: session.token_count, context_limit: 32768, skipped_mentions: [] })
    setChatError('')
  }
  async function onRenameSession(id: string, title: string) {
    await renameSession(episodeId, chunkId, id, title)
    refreshSessions()
  }
  async function onDeleteSession(id: string) {
    await deleteSession(episodeId, chunkId, id)
    if (id === activeSessionId) {
      const list = await listSessions(episodeId, chunkId)
      setSessions(list)
      if (list.length > 0) onSelectSession(list[0].session_id)
      else { setActiveSessionId(null); setMessages([]); setUsage(null) }
    } else {
      refreshSessions()
    }
  }
```

Note: retry now re-runs against the same `activeSessionId`. The server appended the user turn before the engine error, so a retry will store it a second time (a known minor dup on the error path); acceptable for A2. To avoid it entirely would require a server "retry" flag — out of scope.

- [ ] **Step 4: Update the `<RefineChat>` JSX**

```tsx
        <div className="lg:sticky lg:top-6 h-[70vh]">
          <RefineChat
            messages={messages}
            streaming={streaming}
            streamReply={streamReply}
            streamThinking={streamThinking}
            thinkingEnabled={thinkingEnabled}
            usage={usage}
            error={chatError}
            sceneIds={scenes.map(s => s.scene_id)}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onToggleThinking={() => setThinkingEnabled(v => !v)}
            onSend={onSend}
            onAbort={onAbortChat}
            onRetry={onRetryChat}
            onNewChat={onNewChat}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        </div>
```

- [ ] **Step 5: Verify**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run && npm run build`
Expected: tsc clean, tests green, build succeeds. Fix any leftover references to the removed `ChatMessage` import or old handler signatures.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/studio/views/ChapterView.tsx
git commit -m "feat(frontend): ChapterView resumes + manages persisted chat sessions"
```

---

## Task 9: ui-taste pass + verification

**Files:** none (review + verification)

- [ ] **Step 1: Run the `ui-taste` skill** against `RefineChat.tsx` (new history list, rename input, footnote) and the chat parts of `ChapterView.tsx`. Fix any smell-test failures (accent discipline, tokens, focus-visible, restrained motion, real empty/error states — e.g. the history "No saved chats yet." empty state).

- [ ] **Step 2: Final test + build**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/ -q`
Run: `cd frontend && npx vitest run && npm run build`
Expected: backend green, frontend green, build succeeds.

- [ ] **Step 3: Live smoke (requires the stack).** With the backend running, Qwen at `:1090`, and `DB_PATH` set to a real file (not `:memory:`), open a parsed chapter and confirm via the preview tools:
  - Send a message → a session appears, auto-titled after the first reply; the history dropdown lists it.
  - Reload the page → the latest session resumes with its messages and the context ring.
  - New chat → empty session; switch back via history; rename; delete (active falls back to latest/new).
  - `/clear` → starts a fresh session.
  Capture a screenshot.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(chat): ui-taste fixes + A2 verification"
```

---

## Notes for the implementer
- **LLM always mocked in tests.** Patch `animatory.pipeline_router.stream_chat` and `animatory.pipeline_router.generate_title` (route tests), or `animatory.chat_engine.httpx.AsyncClient` (engine tests). Never hit a live Qwen.
- **`:memory:` persistence:** `InMemoryChatStore` keeps one connection so sessions survive across requests in the test process — do not switch it to connect-per-call.
- **Server is the source of truth:** the client sends only `{session_id, message}`. The displayed `messages` are a view: optimistic user bubble on send, assistant bubble on `done`, full reload on session select. Past assistant turns show a muted "proposed N edits" footnote (read-only); live-turn proposals still use the accept/reject banners.
- **Title timing:** the route suppresses the engine's `done`, persists the assistant turn, emits `title` (first exchange only), then emits its own `done` — so the client gets the title before the turn finalizes.
