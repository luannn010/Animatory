from __future__ import annotations

import json
from typing import Any

import aiosqlite

from animatory.runtime.models import RunRecord, RunStatusEnum, OutputArtifact

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    run_id          TEXT PRIMARY KEY,
    agent_id        TEXT,
    status          TEXT,
    attempts        INTEGER,
    started_at      TEXT,
    finished_at     TEXT,
    duration_s      REAL,
    cost            REAL,
    gpu_seconds     REAL,
    tokens          INTEGER,
    acceptance_passed INTEGER,
    outputs         TEXT,
    error           TEXT,
    logs            TEXT,
    episode_id      TEXT,
    phase           TEXT,
    track           TEXT,
    events          TEXT
)
"""

_COLUMNS = [
    "run_id", "agent_id", "status", "attempts", "started_at", "finished_at",
    "duration_s", "cost", "gpu_seconds", "tokens", "acceptance_passed",
    "outputs", "error", "logs", "episode_id", "phase", "track", "events",
]

# Columns added after the original schema — migrated in on init() for old DBs.
_MIGRATIONS = [("events", "TEXT")]


def _serialize(record: RunRecord) -> dict[str, Any]:
    d: dict[str, Any] = {}
    d["run_id"] = record.run_id
    d["agent_id"] = record.agent_id
    d["status"] = record.status.value if isinstance(record.status, RunStatusEnum) else record.status
    d["attempts"] = record.attempts
    d["started_at"] = record.started_at.isoformat() if record.started_at else None
    d["finished_at"] = record.finished_at.isoformat() if record.finished_at else None
    d["duration_s"] = record.duration_s
    d["cost"] = record.cost
    d["gpu_seconds"] = record.gpu_seconds
    d["tokens"] = record.tokens
    d["acceptance_passed"] = int(record.acceptance_passed) if record.acceptance_passed is not None else None
    d["outputs"] = json.dumps([o.model_dump() for o in record.outputs])
    d["error"] = record.error
    d["logs"] = json.dumps(record.logs)
    d["episode_id"] = record.episode_id
    d["phase"] = record.phase
    d["track"] = record.track
    d["events"] = json.dumps(record.events)
    return d


def _metrics_row(row: tuple | None) -> dict:
    if row is None:
        return {"total_runs": 0, "done": 0, "failed": 0, "avg_duration_s": None, "total_cost": None, "acceptance_pass_rate": None}
    total_runs, done, failed, avg_duration_s, total_cost, acceptance_pass_rate = row
    return {
        "total_runs": total_runs or 0,
        "done": done or 0,
        "failed": failed or 0,
        "avg_duration_s": avg_duration_s,
        "total_cost": total_cost,
        "acceptance_pass_rate": acceptance_pass_rate,
    }


def _deserialize(row: tuple) -> RunRecord:
    d = dict(zip(_COLUMNS, row))
    if d.get("outputs"):
        try:
            raw = json.loads(d["outputs"])
            d["outputs"] = [OutputArtifact(**o) for o in raw]
        except Exception:
            d["outputs"] = []
    else:
        d["outputs"] = []
    if d.get("logs"):
        try:
            d["logs"] = json.loads(d["logs"])
        except Exception:
            d["logs"] = []
    else:
        d["logs"] = []
    if d.get("events"):
        try:
            d["events"] = json.loads(d["events"])
        except Exception:
            d["events"] = []
    else:
        d["events"] = []
    if d.get("acceptance_passed") is not None:
        d["acceptance_passed"] = bool(d["acceptance_passed"])
    return RunRecord(**d)


async def _apply_migrations(db: aiosqlite.Connection) -> None:
    """Add columns introduced after the original schema to an existing DB.

    Idempotent without swallowing errors: it inspects ``PRAGMA table_info`` and
    only ALTERs columns that are genuinely missing, so a real DDL failure surfaces
    instead of being hidden by a blanket ``except``. ``col``/``coltype`` come from
    the hardcoded ``_MIGRATIONS`` constant — never from user input.
    """
    cur = await db.execute("PRAGMA table_info(runs)")
    existing = {row[1] for row in await cur.fetchall()}
    for col, coltype in _MIGRATIONS:
        if col in existing:
            continue
        # SQLite DDL identifiers cannot be parameterized; values are trusted constants.
        await db.execute(f"ALTER TABLE runs ADD COLUMN {col} {coltype}")  # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query


class RunStore:
    def __init__(self, db_path: str = "animatory.db") -> None:
        self._db_path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE_SQL)
            await _apply_migrations(db)
            await db.commit()

    async def create(self, record: RunRecord) -> RunRecord:
        row = _serialize(record)
        placeholders = ", ".join(f":{col}" for col in _COLUMNS)
        cols = ", ".join(_COLUMNS)
        sql = f"INSERT INTO runs ({cols}) VALUES ({placeholders})"
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(sql, {col: row.get(col) for col in _COLUMNS})
            await db.commit()
        return record

    async def get(self, run_id: str) -> RunRecord | None:
        cols = ", ".join(_COLUMNS)
        sql = f"SELECT {cols} FROM runs WHERE run_id = ?"
        async with aiosqlite.connect(self._db_path) as db:
            async with db.execute(sql, (run_id,)) as cursor:
                row = await cursor.fetchone()
        return _deserialize(row) if row else None

    async def update(self, run_id: str, **kwargs: Any) -> RunRecord:
        if not kwargs:
            result = await self.get(run_id)
            if result is None:
                raise KeyError(f"RunRecord {run_id!r} not found")
            return result

        set_parts: list[str] = []
        values: list[Any] = []
        for key, value in kwargs.items():
            if key not in _COLUMNS:
                raise ValueError(f"Unknown column: {key!r}")
            if key == "status" and isinstance(value, RunStatusEnum):
                value = value.value
            elif key == "status" and hasattr(value, "value"):
                value = value.value
            if key in ("started_at", "finished_at") and value is not None and not isinstance(value, str):
                value = value.isoformat()
            if key == "outputs" and value is not None and not isinstance(value, str):
                value = json.dumps([o.model_dump() if hasattr(o, "model_dump") else o for o in value])
            if key == "logs" and value is not None and not isinstance(value, str):
                value = json.dumps(value)
            if key == "events" and value is not None and not isinstance(value, str):
                value = json.dumps(value)
            if key == "acceptance_passed" and value is not None:
                value = int(value)
            set_parts.append(f"{key} = ?")
            values.append(value)

        values.append(run_id)
        sql = f"UPDATE runs SET {', '.join(set_parts)} WHERE run_id = ?"
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(sql, values)
            await db.commit()

        result = await self.get(run_id)
        if result is None:
            raise KeyError(f"RunRecord {run_id!r} not found after update")
        return result

    async def list_by_agent(self, agent_id: str) -> list[RunRecord]:
        cols = ", ".join(_COLUMNS)
        sql = f"SELECT {cols} FROM runs WHERE agent_id = ?"
        async with aiosqlite.connect(self._db_path) as db:
            async with db.execute(sql, (agent_id,)) as cursor:
                rows = await cursor.fetchall()
        return [_deserialize(row) for row in rows]

    async def list_all(self, limit: int = 25) -> list[RunRecord]:
        cols = ", ".join(_COLUMNS)
        sql = f"SELECT {cols} FROM runs ORDER BY started_at DESC LIMIT ?"
        async with aiosqlite.connect(self._db_path) as db:
            async with db.execute(sql, (limit,)) as cursor:
                rows = await cursor.fetchall()
        return [_deserialize(row) for row in rows]

    async def metrics(self, agent_id: str | None = None) -> dict:
        where = "WHERE agent_id = ?" if agent_id else ""
        params = (agent_id,) if agent_id else ()
        sql = f"""
            SELECT
                COUNT(*) AS total_runs,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                AVG(duration_s) AS avg_duration_s,
                SUM(cost) AS total_cost,
                AVG(CASE WHEN acceptance_passed IS NOT NULL THEN acceptance_passed ELSE NULL END) AS acceptance_pass_rate
            FROM runs {where}
        """
        async with aiosqlite.connect(self._db_path) as db:
            async with db.execute(sql, params) as cursor:
                row = await cursor.fetchone()
        return _metrics_row(row)


class InMemoryRunStore(RunStore):
    """No-disk variant for tests."""

    def __init__(self) -> None:
        super().__init__(db_path=":memory:")
        self._conn: aiosqlite.Connection | None = None

    async def init(self) -> None:
        self._conn = await aiosqlite.connect(":memory:")
        await self._conn.execute(_CREATE_TABLE_SQL)
        await _apply_migrations(self._conn)
        await self._conn.commit()

    async def _exec(self, sql: str, params=()) -> aiosqlite.Cursor:
        assert self._conn, "Call init() first"
        return await self._conn.execute(sql, params)

    async def create(self, record: RunRecord) -> RunRecord:
        row = _serialize(record)
        placeholders = ", ".join(f":{col}" for col in _COLUMNS)
        cols = ", ".join(_COLUMNS)
        sql = f"INSERT INTO runs ({cols}) VALUES ({placeholders})"
        assert self._conn
        await self._conn.execute(sql, {col: row.get(col) for col in _COLUMNS})
        await self._conn.commit()
        return record

    async def get(self, run_id: str) -> RunRecord | None:
        cols = ", ".join(_COLUMNS)
        sql = f"SELECT {cols} FROM runs WHERE run_id = ?"
        assert self._conn
        async with self._conn.execute(sql, (run_id,)) as cursor:
            row = await cursor.fetchone()
        return _deserialize(row) if row else None

    async def update(self, run_id: str, **kwargs: Any) -> RunRecord:
        if not kwargs:
            result = await self.get(run_id)
            if result is None:
                raise KeyError(f"RunRecord {run_id!r} not found")
            return result

        set_parts: list[str] = []
        values: list[Any] = []
        for key, value in kwargs.items():
            if key not in _COLUMNS:
                raise ValueError(f"Unknown column: {key!r}")
            if key == "status" and isinstance(value, RunStatusEnum):
                value = value.value
            elif key == "status" and hasattr(value, "value"):
                value = value.value
            if key in ("started_at", "finished_at") and value is not None and not isinstance(value, str):
                value = value.isoformat()
            if key == "outputs" and value is not None and not isinstance(value, str):
                value = json.dumps([o.model_dump() if hasattr(o, "model_dump") else o for o in value])
            if key == "logs" and value is not None and not isinstance(value, str):
                value = json.dumps(value)
            if key == "events" and value is not None and not isinstance(value, str):
                value = json.dumps(value)
            if key == "acceptance_passed" and value is not None:
                value = int(value)
            set_parts.append(f"{key} = ?")
            values.append(value)

        values.append(run_id)
        sql = f"UPDATE runs SET {', '.join(set_parts)} WHERE run_id = ?"
        assert self._conn
        await self._conn.execute(sql, values)
        await self._conn.commit()

        result = await self.get(run_id)
        if result is None:
            raise KeyError(f"RunRecord {run_id!r} not found after update")
        return result

    async def list_by_agent(self, agent_id: str) -> list[RunRecord]:
        cols = ", ".join(_COLUMNS)
        sql = f"SELECT {cols} FROM runs WHERE agent_id = ?"
        assert self._conn
        async with self._conn.execute(sql, (agent_id,)) as cursor:
            rows = await cursor.fetchall()
        return [_deserialize(row) for row in rows]

    async def list_all(self, limit: int = 25) -> list[RunRecord]:
        cols = ", ".join(_COLUMNS)
        sql = f"SELECT {cols} FROM runs ORDER BY started_at DESC LIMIT ?"
        assert self._conn
        async with self._conn.execute(sql, (limit,)) as cursor:
            rows = await cursor.fetchall()
        return [_deserialize(row) for row in rows]

    async def metrics(self, agent_id: str | None = None) -> dict:
        where = "WHERE agent_id = ?" if agent_id else ""
        params = (agent_id,) if agent_id else ()
        sql = f"""
            SELECT
                COUNT(*) AS total_runs,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                AVG(duration_s) AS avg_duration_s,
                SUM(cost) AS total_cost,
                AVG(CASE WHEN acceptance_passed IS NOT NULL THEN acceptance_passed ELSE NULL END) AS acceptance_pass_rate
            FROM runs {where}
        """
        assert self._conn
        async with self._conn.execute(sql, params) as cursor:
            row = await cursor.fetchone()
        return _metrics_row(row)
