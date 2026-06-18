"""SQLite-backed image-job store + seed-per-character (BACKEND_SPEC.md §2, §10).

Mirrors the aiosqlite pattern in ``animatory.run_store`` — no Redis (decision: reuse asyncio +
SQLite). A single class supports both a file path and ``:memory:`` (a persistent connection is
held only for ``:memory:``, since each fresh connect to ``:memory:`` would otherwise get an empty
database).

Two tables:
- ``image_jobs``  — the async submit+poll job records (spec §9 ``GET /jobs/{id}`` shape).
- ``character_seeds`` — ``character_id -> last_seed`` so a rig request omitting ``seed`` but
  giving ``character_id`` reuses the stored seed (cheapest consistency before LoRA, spec §10).
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

import aiosqlite

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS image_jobs (
    job_id        TEXT PRIMARY KEY,
    status        TEXT,
    asset_type    TEXT,
    character_id  TEXT,
    scene_id      TEXT,
    image_url     TEXT,
    seed          INTEGER,
    meta          TEXT,
    error         TEXT,
    created_at    TEXT
);
CREATE TABLE IF NOT EXISTS character_seeds (
    character_id  TEXT PRIMARY KEY,
    seed          INTEGER
);
"""

_COLUMNS = [
    "job_id", "status", "asset_type", "character_id", "scene_id",
    "image_url", "seed", "meta", "error", "created_at",
]


def _row_to_dict(row: tuple) -> dict[str, Any]:
    d = dict(zip(_COLUMNS, row))
    if d.get("meta"):
        try:
            d["meta"] = json.loads(d["meta"])
        except Exception:
            d["meta"] = {}
    else:
        d["meta"] = {}
    return d


class ImageJobStore:
    def __init__(self, db_path: str = "animatory.db") -> None:
        self._db_path = db_path
        self._mem_conn: aiosqlite.Connection | None = None

    async def init(self) -> None:
        if self._db_path == ":memory:":
            self._mem_conn = await aiosqlite.connect(":memory:")
            await self._mem_conn.executescript(_CREATE_SQL)
            await self._mem_conn.commit()
        else:
            async with aiosqlite.connect(self._db_path) as db:
                await db.executescript(_CREATE_SQL)
                await db.commit()

    async def close(self) -> None:
        if self._mem_conn is not None:
            await self._mem_conn.close()
            self._mem_conn = None

    @asynccontextmanager
    async def _db(self):
        """Yield a connection. For ``:memory:`` reuse the resident one; else open/close."""
        if self._mem_conn is not None:
            yield self._mem_conn
            return
        db = await aiosqlite.connect(self._db_path)
        try:
            yield db
        finally:
            await db.close()

    # -- jobs ---------------------------------------------------------------------
    async def create(
        self,
        job_id: str,
        *,
        status: str = "queued",
        asset_type: str | None = None,
        character_id: str | None = None,
        scene_id: str | None = None,
        created_at: str | None = None,
    ) -> dict:
        row = {
            "job_id": job_id, "status": status, "asset_type": asset_type,
            "character_id": character_id, "scene_id": scene_id,
            "image_url": None, "seed": None, "meta": None, "error": None,
            "created_at": created_at,
        }
        placeholders = ", ".join(f":{c}" for c in _COLUMNS)
        sql = f"INSERT INTO image_jobs ({', '.join(_COLUMNS)}) VALUES ({placeholders})"
        async with self._db() as db:
            await db.execute(sql, row)
            await db.commit()
        return await self.get(job_id)  # type: ignore[return-value]

    async def get(self, job_id: str) -> dict | None:
        sql = f"SELECT {', '.join(_COLUMNS)} FROM image_jobs WHERE job_id = ?"
        async with self._db() as db:
            async with db.execute(sql, (job_id,)) as cur:
                row = await cur.fetchone()
        return _row_to_dict(row) if row else None

    async def update(self, job_id: str, **kwargs: Any) -> dict:
        if not kwargs:
            result = await self.get(job_id)
            if result is None:
                raise KeyError(f"image job {job_id!r} not found")
            return result
        set_parts: list[str] = []
        values: list[Any] = []
        for key, value in kwargs.items():
            if key not in _COLUMNS:
                raise ValueError(f"Unknown column: {key!r}")
            if key == "meta" and value is not None and not isinstance(value, str):
                value = json.dumps(value)
            set_parts.append(f"{key} = ?")
            values.append(value)
        values.append(job_id)
        sql = f"UPDATE image_jobs SET {', '.join(set_parts)} WHERE job_id = ?"
        async with self._db() as db:
            await db.execute(sql, values)
            await db.commit()
        result = await self.get(job_id)
        if result is None:
            raise KeyError(f"image job {job_id!r} not found after update")
        return result

    async def list(
        self,
        *,
        asset_type: str | None = None,
        scene_id: str | None = None,
        character_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        where: list[str] = []
        params: list[Any] = []
        for col, val in (
            ("asset_type", asset_type), ("scene_id", scene_id),
            ("character_id", character_id), ("status", status),
        ):
            if val is not None:
                where.append(f"{col} = ?")
                params.append(val)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        params.append(limit)
        sql = (
            f"SELECT {', '.join(_COLUMNS)} FROM image_jobs {clause} "
            f"ORDER BY created_at DESC LIMIT ?"
        )
        async with self._db() as db:
            async with db.execute(sql, params) as cur:
                rows = await cur.fetchall()
        return [_row_to_dict(r) for r in rows]

    # -- seed-per-character (spec §10) --------------------------------------------
    async def get_seed(self, character_id: str) -> int | None:
        async with self._db() as db:
            async with db.execute(
                "SELECT seed FROM character_seeds WHERE character_id = ?", (character_id,)
            ) as cur:
                row = await cur.fetchone()
        return int(row[0]) if row and row[0] is not None else None

    async def set_seed(self, character_id: str, seed: int) -> None:
        async with self._db() as db:
            await db.execute(
                "INSERT INTO character_seeds (character_id, seed) VALUES (?, ?) "
                "ON CONFLICT(character_id) DO UPDATE SET seed = excluded.seed",
                (character_id, int(seed)),
            )
            await db.commit()
