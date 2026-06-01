"""Seed fixtures mirroring the frontend mock (``frontend/src/studio/mockApi.ts``).

Keeping these in sync means the app behaves identically whether the frontend
runs on its own mock or against this backend.
"""
from __future__ import annotations

from animatory.studio.models import (
    Asset, Phase, PhaseStatus, PostStage, Project, Scene, VendorScene,
)

PHASE_ORDER: list[Phase] = [Phase.parse, Phase.pre, Phase.vendor, Phase.post]


def phases_up_to(current: Phase) -> dict[Phase, PhaseStatus]:
    idx = PHASE_ORDER.index(current)
    out: dict[Phase, PhaseStatus] = {}
    for i, p in enumerate(PHASE_ORDER):
        out[p] = (
            PhaseStatus.complete if i < idx
            else PhaseStatus.active if i == idx
            else PhaseStatus.locked
        )
    return out


def seed_projects() -> list[Project]:
    return [
        Project(
            id="ep01", title="Ep. 01 — The Awakening",
            thumbnail="linear-gradient(135deg,#1e3a5f,#2d5a9e)",
            current_phase=Phase.vendor, phases=phases_up_to(Phase.vendor),
            scene_count=24, created_at="2026-05-20T00:00:00Z",
        ),
        Project(
            id="ep02", title="Ep. 02 — Shadows Fall",
            thumbnail="linear-gradient(135deg,#2d1b4e,#5b3480)",
            current_phase=Phase.pre, phases=phases_up_to(Phase.pre),
            scene_count=18, created_at="2026-05-24T00:00:00Z",
        ),
        Project(
            id="ep00", title="Ep. 00 — Pilot",
            thumbnail="linear-gradient(135deg,#0f3d2e,#1a5c40)",
            current_phase=Phase.post, phases=phases_up_to(Phase.post),
            scene_count=12, created_at="2026-05-10T00:00:00Z",
        ),
        Project(
            id="ep03", title="Ep. 03 — The Storm",
            thumbnail="linear-gradient(135deg,#3b2000,#6b3d00)",
            current_phase=Phase.parse, phases=phases_up_to(Phase.parse),
            scene_count=22, created_at="2026-06-01T00:00:00Z",
        ),
    ]


def seed_scenes(project_id: str) -> list[Scene]:
    base = [
        (1, "Hana wakes to a thunderous crash as lightning strobes across the skyline.", "INT - Apartment", ["Hana"], "0:42"),
        (2, "She runs to the window and sees a storm cloud shaped like a face.", "INT - Apartment", ["Hana"], "0:28"),
        (3, "Riku slams his phone down, staring at a weather alert on his monitor.", "INT - Office", ["Riku"], "0:35"),
        (4, "City streets — citizens look up, confused. Umbrellas invert.", "EXT - Street", ["Extras"], "1:04"),
        (5, "Hana sprints down the stairwell, dodging a falling light fitting.", "INT - Stairwell", ["Hana"], "0:22"),
        (6, "Riku and Hana collide at the building exit. Recognition. Tension.", "EXT - Building", ["Hana", "Riku"], "0:48"),
    ]
    return [
        Scene(id=f"{project_id}-sc{n}", project_id=project_id, number=n,
              description=desc, location=loc, characters=chars, duration=dur)
        for (n, desc, loc, chars, dur) in base
    ]


def seed_assets(project_id: str) -> list[Asset]:
    base = [
        ("Hana", "character", "done", "👩‍🦰"),
        ("Riku", "character", "color", "👨"),
        ("City BG", "background", "done", "🏙"),
        ("Apartment BG", "background", "clean", "🏠"),
        ("Office BG", "background", "rough", "🏢"),
        ("Umbrella", "prop", "done", "☂️"),
        ("Phone", "prop", "done", "📱"),
        ("Lightning FX", "fx", "rough", "⚡"),
    ]
    return [
        Asset(id=f"{project_id}-as{i+1}", project_id=project_id, name=name,
              type=typ, status=status, emoji=emoji)
        for i, (name, typ, status, emoji) in enumerate(base)
    ]


def seed_vendor_scenes(project_id: str) -> list[VendorScene]:
    return [
        VendorScene(id=f"{project_id}-vs1", project_id=project_id, scene_ref="SC-01",
                    stage="editor", stage_status="done", retake_count=0,
                    completed_stages=["rigs", "setup", "block", "animate", "take1", "editor"], approved=True),
        VendorScene(id=f"{project_id}-vs2", project_id=project_id, scene_ref="SC-06",
                    stage="animate", stage_status="active", retake_count=0,
                    completed_stages=["rigs", "setup", "block"], approved=False),
        VendorScene(id=f"{project_id}-vs3", project_id=project_id, scene_ref="SC-09",
                    stage="animate", stage_status="retake", retake_count=2,
                    completed_stages=["rigs", "setup", "block"], approved=False),
        VendorScene(id=f"{project_id}-vs4", project_id=project_id, scene_ref="SC-15",
                    stage="setup", stage_status="active", retake_count=0,
                    completed_stages=["rigs"], approved=False),
        VendorScene(id=f"{project_id}-vs5", project_id=project_id, scene_ref="SC-22",
                    stage="rigs", stage_status="pending", retake_count=0,
                    completed_stages=[], approved=False),
    ]


def seed_post_stages(project_id: str) -> list[PostStage]:
    return [
        PostStage(id=f"{project_id}-ps1", name="Edit", sub="Assemble take 1s into cut", status="done"),
        PostStage(id=f"{project_id}-ps2", name="Dialogue", sub="Final mix from cast lines", status="done", parallel=True, track="dialogue"),
        PostStage(id=f"{project_id}-ps3", name="Music", sub="Score locked", status="active", parallel=True, track="music"),
        PostStage(id=f"{project_id}-ps4", name="SFX", sub="Foley + design", status="pending", parallel=True, track="sfx"),
        PostStage(id=f"{project_id}-ps5", name="Mix", sub="Dialogue, music, SFX balance", status="pending"),
        PostStage(id=f"{project_id}-ps6", name="Color Correction", sub="Grade and LUT application", status="active"),
        PostStage(id=f"{project_id}-ps7", name="Online / QC", sub="Final quality check, subtitles", status="pending"),
        PostStage(id=f"{project_id}-ps8", name="Deliver", sub="Export master files and upload", status="locked"),
    ]
