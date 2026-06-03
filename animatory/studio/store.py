"""SQLite-backed studio store + background parse-job lifecycle.

Projects and their scenes persist to SQLite (the shared ``animatory.db``, like
``RunStore``) so they survive restarts. Reads are served from an in-memory cache
that is hydrated from the DB on :meth:`init`; mutations update the cache and
write through to the DB. Parse jobs are ephemeral and remain in memory only.

On first run (empty DB) the cache/DB are populated from the seed fixtures, so a
fresh install still shows the demo projects.
"""
from __future__ import annotations

import asyncio
import json
import uuid

import aiosqlite

from animatory.studio import providers
from animatory.studio.models import (
    Asset, JobStatus, ParseJob, Phase, PhaseStatus, PostStage, Project,
    Scene, VendorScene, VoicePreview,
)
from animatory.studio.seed import (
    PHASE_ORDER, phases_up_to, seed_assets, seed_post_stages, seed_projects,
    seed_scenes, seed_vendor_scenes,
)


class ProjectNotFound(KeyError):
    pass


class JobNotFound(KeyError):
    pass


_CREATE_PROJECTS_SQL = """
CREATE TABLE IF NOT EXISTS studio_projects (
    id   TEXT PRIMARY KEY,
    ord  INTEGER,
    data TEXT
)
"""

_CREATE_SCENES_SQL = """
CREATE TABLE IF NOT EXISTS studio_scenes (
    project_id TEXT PRIMARY KEY,
    data       TEXT
)
"""


class StudioStore:
    def __init__(self, db_path: str = "animatory.db") -> None:
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None
        self._projects: list[Project] = []
        self._scenes: dict[str, list[Scene]] = {}
        self._new_counter = 0
        self._jobs: dict[str, ParseJob] = {}

    # ── persistence ─────────────────────────────────────────────────────────────

    async def init(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("PRAGMA busy_timeout=5000")
        await self._db.execute(_CREATE_PROJECTS_SQL)
        await self._db.execute(_CREATE_SCENES_SQL)
        await self._db.commit()

        async with self._db.execute("SELECT COUNT(*) FROM studio_projects") as cur:
            (count,) = await cur.fetchone()

        if count == 0:
            # First run: persist the seed fixtures so the DB is the source of truth.
            for i, p in enumerate(seed_projects()):
                await self._write_project(p, ord=i)
                await self._write_scenes(p.id, seed_scenes(p.id))
            await self._db.commit()

        await self._hydrate()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def _hydrate(self) -> None:
        """Load the persisted projects/scenes into the in-memory read cache."""
        assert self._db, "call init() first"
        self._projects = []
        self._scenes = {}

        async with self._db.execute("SELECT data FROM studio_projects ORDER BY ord ASC") as cur:
            for (data,) in await cur.fetchall():
                self._projects.append(Project.model_validate(json.loads(data)))

        async with self._db.execute("SELECT project_id, data FROM studio_scenes") as cur:
            for pid, data in await cur.fetchall():
                self._scenes[pid] = [Scene.model_validate(s) for s in json.loads(data)]
        for p in self._projects:
            self._scenes.setdefault(p.id, [])

        # Restore the create counter so new ids (new{N}) don't collide with saved ones.
        max_n = 0
        for p in self._projects:
            if p.id.startswith("new"):
                try:
                    max_n = max(max_n, int(p.id[3:]))
                except ValueError:
                    pass
        self._new_counter = max_n

    async def _write_project(self, project: Project, ord: int | None = None) -> None:
        assert self._db, "call init() first"
        if ord is None:
            async with self._db.execute("SELECT ord FROM studio_projects WHERE id = ?", (project.id,)) as cur:
                row = await cur.fetchone()
            ord = row[0] if row else 0
        await self._db.execute(
            "INSERT INTO studio_projects (id, ord, data) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET ord=excluded.ord, data=excluded.data",
            (project.id, ord, json.dumps(project.model_dump(mode="json"))),
        )

    async def _write_scenes(self, project_id: str, scenes: list[Scene]) -> None:
        assert self._db, "call init() first"
        await self._db.execute(
            "INSERT INTO studio_scenes (project_id, data) VALUES (?, ?) "
            "ON CONFLICT(project_id) DO UPDATE SET data=excluded.data",
            (project_id, json.dumps([s.model_dump(mode="json") for s in scenes])),
        )

    # ── projects ──────────────────────────────────────────────────────────────

    def _find(self, project_id: str) -> Project:
        for p in self._projects:
            if p.id == project_id:
                return p
        raise ProjectNotFound(project_id)

    def list_projects(self) -> list[Project]:
        return list(self._projects)

    def get_project(self, project_id: str) -> Project:
        return self._find(project_id)

    async def create_project(self, title: str | None = None) -> Project:
        self._new_counter += 1
        pid = f"new{self._new_counter}"
        project = Project(
            id=pid,
            title=title or f"Untitled Episode {self._new_counter}",
            thumbnail="linear-gradient(135deg,#334155,#1e293b)",
            current_phase=Phase.parse,
            phases=phases_up_to(Phase.parse),
            scene_count=0,
            created_at="2026-06-02T00:00:00Z",
        )
        self._projects.insert(0, project)
        self._scenes[pid] = []
        # Negative ord keeps created projects ahead of seeds, newest first.
        await self._write_project(project, ord=-self._new_counter)
        await self._write_scenes(pid, [])
        await self._db.commit()
        return project

    async def update_title(self, project_id: str, title: str) -> Project:
        p = self._find(project_id)
        p.title = title
        await self._write_project(p)
        await self._db.commit()
        return p

    async def advance_phase(self, project_id: str, to: Phase) -> Project:
        p = self._find(project_id)
        target = PHASE_ORDER.index(to)
        for i, ph in enumerate(PHASE_ORDER):
            p.phases[ph] = (
                PhaseStatus.complete if i < target
                else PhaseStatus.active if i == target
                else PhaseStatus.locked
            )
        p.current_phase = to
        await self._write_project(p)
        await self._db.commit()
        return p

    # ── child resources ─────────────────────────────────────────────────────────

    def get_scenes(self, project_id: str) -> list[Scene]:
        self._find(project_id)
        return self._scenes.get(project_id, [])

    def get_assets(self, project_id: str) -> list[Asset]:
        self._find(project_id)
        return seed_assets(project_id)

    def get_vendor_scenes(self, project_id: str) -> list[VendorScene]:
        self._find(project_id)
        return seed_vendor_scenes(project_id)

    def get_post_stages(self, project_id: str) -> list[PostStage]:
        self._find(project_id)
        return seed_post_stages(project_id)

    # ── voice (synchronous stub) ─────────────────────────────────────────────────

    async def voice_preview(self, project_id: str, character: str, voice: str) -> VoicePreview:
        self._find(project_id)
        return await providers.generate_voice(project_id, character, voice)

    # ── parse job (background + SSE) ─────────────────────────────────────────────

    def get_job(self, job_id: str) -> ParseJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFound(job_id)
        return job

    def start_parse(self, project_id: str, text: str, filenames: list[str]) -> ParseJob:
        self._find(project_id)
        job_id = str(uuid.uuid4())
        job = ParseJob(job_id=job_id, project_id=project_id, status=JobStatus.queued, progress=0.0)
        self._jobs[job_id] = job
        asyncio.create_task(self._run_parse(job, text, filenames))
        return job

    async def _run_parse(self, job: ParseJob, text: str, filenames: list[str]) -> None:
        try:
            job.status = JobStatus.running
            steps = ["Reading sources", "Detecting scene boundaries", "Extracting metadata", "Finalizing breakdown"]
            for i, step in enumerate(steps):
                await asyncio.sleep(0.15)
                job.logs.append(step)
                job.progress = round((i + 1) / (len(steps) + 1), 2)

            scenes = await providers.parse_script(job.project_id, text, filenames)
            self._scenes[job.project_id] = scenes
            project = self._find(job.project_id)
            project.scene_count = len(scenes)

            # Persist the parsed scenes + updated scene_count.
            await self._write_scenes(job.project_id, scenes)
            await self._write_project(project)
            await self._db.commit()

            job.scenes = scenes
            job.progress = 1.0
            job.status = JobStatus.done
            job.logs.append(f"Extracted {len(scenes)} scenes")
        except Exception as exc:  # pragma: no cover - defensive
            job.status = JobStatus.failed
            job.error = str(exc)
