"""Showcase driver: build the li-wei character + two location rigs, then two panels.

Runs the real Z-Image pipeline through the ZImageExecutor exactly as the server would —
Stage 1 (reference images for the hand-authored rigs) then Stage 2 (composed panels:
the boy at the school, the boy on the mountain). Usage:

    D:/Animatory/.venv/Scripts/python.exe scripts/generate_liwei_showcase.py
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # this checkout's animatory, not the installed one

from animatory.executors.zimage import ZImageExecutor
from animatory.models import AgentDef, LayerEnum, RunRequest, StackEnum


def _agent(aid: str) -> AgentDef:
    return AgentDef(id=aid, layer=LayerEnum.execution, stack=StackEnum.image,
                    role="showcase", responsibility="showcase")


async def main() -> int:
    ex = ZImageExecutor()

    t0 = time.time()
    print("[1/2] Stage 1 — building rigs (reference images)...", flush=True)
    rig_res = await ex.execute(RunRequest(context={
        "mode": "build_rigs",
        "entities": [
            {"name": "li wei", "kind": "character"},
            {"name": "school courtyard", "kind": "location"},
            {"name": "mountain peak", "kind": "location"},
        ],
    }), _agent("design.rig"))
    if rig_res.error:
        print("RIG BUILD ERROR:", rig_res.error)
        return 1
    for o in rig_res.outputs:
        print(f"  {o.type:5s} {o.name:30s} {o.path}", flush=True)

    print("[2/2] Stage 2 — generating panels...", flush=True)
    panel_res = await ex.execute(RunRequest(context={
        "mode": "gen_panels",
        "batch_id": "liwei_showcase",
        "scene_locations": {"1": "school courtyard", "2": "mountain peak"},
        "shots": [
            {"id": "001", "sceneId": 1, "characters": ["li wei"],
             "action": "practicing a flying kick in the school courtyard, dynamic action pose"},
            {"id": "002", "sceneId": 2, "characters": ["li wei"],
             "action": "standing in horse stance on the mountain peak at dawn, wind-blown sash"},
        ],
    }), _agent("board.panels"))
    if panel_res.error:
        print("PANEL ERROR:", panel_res.error)
        return 1
    for o in panel_res.outputs:
        print(f"  {o.type:5s} {o.name:30s} {o.path}", flush=True)
    print(f"done in {time.time() - t0:.0f}s | metrics: rigs={rig_res.metrics} panels={panel_res.metrics}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
