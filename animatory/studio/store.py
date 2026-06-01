"""In-memory studio store + background parse-job lifecycle.

Mirrors the frontend ``studioApi``. State lives in process memory and resets
when the store is re-created (one instance per app lifespan). Parse runs as a
background asyncio task that streams progress, mirroring the agent run model.
"""
from __future__ import annotations

import asyncio
import uuid

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


class StudioStore:
    def __init__(self) -> None:
        self._projects: list[Project] = seed_projects()
        self._scenes: dict[str, list[Scene]] = {p.id: seed_scenes(p.id) for p in self._projects}
        self._new_counter = 0
        self._jobs: dict[str, ParseJob] = {}

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

    def create_project(self, title: str | None = None) -> Project:
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
        return project

    def update_title(self, project_id: str, title: str) -> Project:
        p = self._find(project_id)
        p.title = title
        return p

    def advance_phase(self, project_id: str, to: Phase) -> Project:
        p = self._find(project_id)
        target = PHASE_ORDER.index(to)
        for i, ph in enumerate(PHASE_ORDER):
            p.phases[ph] = (
                PhaseStatus.complete if i < target
                else PhaseStatus.active if i == target
                else PhaseStatus.locked
            )
        p.current_phase = to
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

            job.scenes = scenes
            job.progress = 1.0
            job.status = JobStatus.done
            job.logs.append(f"Extracted {len(scenes)} scenes")
        except Exception as exc:  # pragma: no cover - defensive
            job.status = JobStatus.failed
            job.error = str(exc)
