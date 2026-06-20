"""Persistence for mesh deform.

- ``MeshStore`` — durable per-asset ``MeshData`` (aiosqlite), mirroring the
  ``ImageJobStore`` connection pattern (file path or ``:memory:``).
- ``MeshJobStore`` — ephemeral in-memory ``MeshJob`` records plus an
  active-job-per-asset map (the studio ``ParseJob`` pattern). Jobs need not
  survive a restart; the durable ``MeshData`` does.
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

import aiosqlite

from animatory.deform.models import MeshData, MeshJob

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS mesh_data (
    asset_id     TEXT PRIMARY KEY,
    version      INTEGER,
    status       TEXT,
    generated_at TEXT,
    blob         TEXT
);
"""


class MeshJobNotFound(Exception):
    """Raised when a mesh job id is unknown."""


class MeshStore:
    """aiosqlite-backed ``MeshData`` store, keyed by ``asset_id`` (latest version)."""

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

    async def _row(self, asset_id: str) -> tuple | None:
        async with self._db() as db:
            async with db.execute(
                "SELECT version, status, blob FROM mesh_data WHERE asset_id = ?", (asset_id,)
            ) as cur:
                return await cur.fetchone()

    async def get(self, asset_id: str) -> MeshData | None:
        """The persisted mesh, or None when no mesh blob exists yet."""
        row = await self._row(asset_id)
        if not row or not row[2]:
            return None
        return MeshData.model_validate_json(row[2])

    async def get_status(self, asset_id: str) -> str:
        row = await self._row(asset_id)
        return row[1] if row else "none"

    async def current_version(self, asset_id: str) -> int:
        row = await self._row(asset_id)
        return int(row[0]) if row and row[0] is not None else 0

    async def set_generating(self, asset_id: str) -> None:
        """Mark an asset as mid-generation without disturbing its prior version/blob."""
        async with self._db() as db:
            await db.execute(
                "INSERT INTO mesh_data (asset_id, version, status, generated_at, blob) "
                "VALUES (?, 0, 'generating', NULL, NULL) "
                "ON CONFLICT(asset_id) DO UPDATE SET status = 'generating'",
                (asset_id,),
            )
            await db.commit()

    async def set_status(self, asset_id: str, status: str) -> None:
        async with self._db() as db:
            await db.execute(
                "UPDATE mesh_data SET status = ? WHERE asset_id = ?", (status, asset_id)
            )
            await db.commit()

    async def save(self, data: MeshData) -> MeshData:
        blob = data.model_dump_json(by_alias=True)
        async with self._db() as db:
            await db.execute(
                "INSERT INTO mesh_data (asset_id, version, status, generated_at, blob) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(asset_id) DO UPDATE SET "
                "version = excluded.version, status = excluded.status, "
                "generated_at = excluded.generated_at, blob = excluded.blob",
                (data.asset_id, data.version, data.status, data.generated_at, blob),
            )
            await db.commit()
        return data

    async def delete(self, asset_id: str) -> None:
        async with self._db() as db:
            await db.execute("DELETE FROM mesh_data WHERE asset_id = ?", (asset_id,))
            await db.commit()


class MeshJobStore:
    """In-memory mesh jobs + one active job per asset (jobs are ephemeral)."""

    def __init__(self) -> None:
        self._jobs: dict[str, MeshJob] = {}
        self._active: dict[str, str] = {}

    def create(self, asset_id: str) -> MeshJob:
        job = MeshJob(
            job_id=str(uuid.uuid4()), asset_id=asset_id,
            status="queued", progress=0.0, stage=None, error=None,
        )
        self._jobs[job.job_id] = job
        self._active[asset_id] = job.job_id
        return job

    def get(self, job_id: str) -> MeshJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise MeshJobNotFound(job_id)
        return job

    def update(self, job_id: str, **fields) -> MeshJob:
        job = self.get(job_id)
        for key, value in fields.items():
            setattr(job, key, value)
        return job

    def active(self, asset_id: str) -> MeshJob | None:
        """The in-flight (queued/running) job for an asset, if any."""
        job_id = self._active.get(asset_id)
        if job_id is None:
            return None
        job = self._jobs.get(job_id)
        if job is None or job.status in ("done", "failed"):
            self._active.pop(asset_id, None)
            return None
        return job

    def clear_active(self, asset_id: str) -> None:
        self._active.pop(asset_id, None)
