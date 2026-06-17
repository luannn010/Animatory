"""End-to-end wiring for the Z-Image agents through the real API (fake executors, no GPU).

Proves: agent registered → POST /agents/{id}/run → BaseAgent validates inputs → executor
runs (FakeExecutor for stack=image) → image artifacts persisted in RunRecord.outputs,
readable via GET /runs/{run_id}. This is the agent→executor→run-record→studio path.
"""

from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient


async def _wait_for_run(client: AsyncClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        r = await client.get(f"/runs/{run_id}")
        if r.status_code == 200 and r.json().get("status") in ("done", "failed"):
            return r.json()
        if asyncio.get_event_loop().time() >= deadline:
            return r.json() if r.status_code == 200 else {}
        await asyncio.sleep(0.1)


@pytest.mark.asyncio
async def test_design_rig_agent_listed_with_image_stack(client: AsyncClient):
    r = await client.get("/agents")
    assert r.status_code == 200
    agents = {a["id"]: a for a in r.json()}
    assert "design.rig" in agents and agents["design.rig"]["stack"] == "image"
    assert "board.panels" in agents and agents["board.panels"]["stack"] == "image"


@pytest.mark.asyncio
async def test_design_rig_run_yields_image_artifact(client: AsyncClient):
    r = await client.post("/agents/design.rig/run", json={
        "context": {"entities": [{"name": "Rusty", "kind": "character"},
                                 {"name": "Workshop", "kind": "location"}]},
        "system_prompt": "",
    })
    assert r.status_code == 200
    data = await _wait_for_run(client, r.json()["run_id"])
    assert data.get("status") == "done"
    assert any(o["type"] == "image" for o in data.get("outputs", []))


@pytest.mark.asyncio
async def test_board_panels_run_yields_image_artifact(client: AsyncClient):
    r = await client.post("/agents/board.panels/run", json={
        "context": {
            "shots": [{"id": "001", "sceneId": 0, "action": "hammers a bolt", "characters": ["Rusty"]}],
            "rigs": "rigs/",
        },
        "system_prompt": "",
    })
    assert r.status_code == 200
    data = await _wait_for_run(client, r.json()["run_id"])
    assert data.get("status") == "done"
    assert any(o["type"] == "image" for o in data.get("outputs", []))
