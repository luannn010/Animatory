"""Tests for the studio surface (/studio/*)."""
import asyncio

import pytest
from httpx import AsyncClient


async def _wait_for_job(client: AsyncClient, job_id: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        r = await client.get(f"/studio/parse-jobs/{job_id}")
        if r.status_code == 200 and r.json().get("status") in ("done", "failed"):
            return r.json()
        if asyncio.get_event_loop().time() >= deadline:
            return r.json() if r.status_code == 200 else {}
        await asyncio.sleep(0.1)


@pytest.mark.asyncio
async def test_list_projects_seeded_phases(client: AsyncClient):
    r = await client.get("/studio/projects")
    assert r.status_code == 200
    projects = r.json()
    assert len(projects) >= 4
    phases = {p["currentPhase"] for p in projects}
    assert {"parse", "pre", "vendor", "post"} <= phases


@pytest.mark.asyncio
async def test_projects_serialize_camelcase(client: AsyncClient):
    r = await client.get("/studio/projects")
    p = r.json()[0]
    # camelCase aliases must match the frontend TS types
    for key in ("currentPhase", "sceneCount", "createdAt"):
        assert key in p


@pytest.mark.asyncio
async def test_get_project_and_404(client: AsyncClient):
    r = await client.get("/studio/projects/ep01")
    assert r.status_code == 200
    assert r.json()["id"] == "ep01"
    assert (await client.get("/studio/projects/nope")).status_code == 404


@pytest.mark.asyncio
async def test_create_project_at_parse(client: AsyncClient):
    r = await client.post("/studio/projects", json={})
    assert r.status_code == 200
    created = r.json()
    assert created["currentPhase"] == "parse"
    assert created["phases"]["parse"] == "active"
    # appears in the list
    listed = (await client.get("/studio/projects")).json()
    assert created["id"] in [p["id"] for p in listed]


@pytest.mark.asyncio
async def test_rename_project(client: AsyncClient):
    r = await client.patch("/studio/projects/ep02", json={"title": "Renamed Ep"})
    assert r.status_code == 200
    assert r.json()["title"] == "Renamed Ep"
    assert (await client.get("/studio/projects/ep02")).json()["title"] == "Renamed Ep"


@pytest.mark.asyncio
async def test_advance_phase(client: AsyncClient):
    created = (await client.post("/studio/projects", json={})).json()
    r = await client.post(f"/studio/projects/{created['id']}/advance", json={"to": "pre"})
    assert r.status_code == 200
    body = r.json()
    assert body["currentPhase"] == "pre"
    assert body["phases"]["parse"] == "complete"
    assert body["phases"]["pre"] == "active"


@pytest.mark.asyncio
async def test_child_resources(client: AsyncClient):
    assert len((await client.get("/studio/projects/ep01/scenes")).json()) > 0
    assert len((await client.get("/studio/projects/ep01/assets")).json()) > 0
    vendor = (await client.get("/studio/projects/ep01/vendor-scenes")).json()
    assert any(v["stageStatus"] == "retake" for v in vendor)
    assert any(v["approved"] for v in vendor)
    post = (await client.get("/studio/projects/ep01/post-stages")).json()
    assert any(s.get("parallel") for s in post)


@pytest.mark.asyncio
async def test_voice_preview_stub(client: AsyncClient):
    r = await client.post("/studio/projects/ep02/casting/Hana/preview?voice=Voice%20A")
    assert r.status_code == 200
    body = r.json()
    assert body["character"] == "Hana"
    assert body["audioUrl"].endswith(".wav")


@pytest.mark.asyncio
async def test_parse_job_lifecycle(client: AsyncClient):
    created = (await client.post("/studio/projects", json={})).json()
    pid = created["id"]
    # no scenes yet
    assert (await client.get(f"/studio/projects/{pid}/scenes")).json() == []

    start = await client.post(f"/studio/projects/{pid}/parse", json={"text": "INT. ROOM - DAY"})
    assert start.status_code == 200
    job_id = start.json()["jobId"]

    done = await _wait_for_job(client, job_id)
    assert done["status"] == "done"
    assert len(done["scenes"]) > 0

    # scenes now persisted on the project, scene_count updated
    scenes = (await client.get(f"/studio/projects/{pid}/scenes")).json()
    assert len(scenes) == len(done["scenes"])
    assert (await client.get(f"/studio/projects/{pid}")).json()["sceneCount"] == len(scenes)


@pytest.mark.asyncio
async def test_parse_job_404(client: AsyncClient):
    assert (await client.get("/studio/parse-jobs/nope")).status_code == 404


@pytest.mark.asyncio
async def test_parse_job_sse(client: AsyncClient):
    created = (await client.post("/studio/projects", json={})).json()
    start = await client.post(f"/studio/projects/{created['id']}/parse", json={"text": "x"})
    job_id = start.json()["jobId"]

    events = []
    async with client.stream("GET", f"/studio/parse-jobs/{job_id}/stream") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
            if "done" in events:
                break
    assert "done" in events
    assert "status" in events
