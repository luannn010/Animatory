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
