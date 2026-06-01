"""Tests for the Animatory FastAPI application."""
import asyncio

import pytest
from httpx import AsyncClient


async def _wait_for_run(client: AsyncClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        r = await client.get(f"/runs/{run_id}")
        if r.status_code == 200:
            data = r.json()
            if data.get("status") in ("done", "failed"):
                return data
        if asyncio.get_event_loop().time() >= deadline:
            return r.json() if r.status_code == 200 else {}
        await asyncio.sleep(0.1)


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json().get("agents_loaded", 0) > 0


@pytest.mark.asyncio
async def test_agents_list(client: AsyncClient):
    r = await client.get("/agents")
    assert r.status_code == 200
    assert len(r.json()) >= 1


@pytest.mark.asyncio
async def test_run_showrunner_returns_run_id(client: AsyncClient):
    r = await client.post(
        "/agents/orch.showrunner/run",
        json={"context": {"final_script": "INT. STUDIO - DAY"}, "system_prompt": ""},
    )
    assert r.status_code == 200
    assert "run_id" in r.json()


@pytest.mark.asyncio
async def test_run_nonexistent_agent_404(client: AsyncClient):
    r = await client.post("/agents/nonexistent.xyz/run", json={"context": {}, "system_prompt": ""})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_run_after_completion(client: AsyncClient):
    post_r = await client.post(
        "/agents/orch.showrunner/run",
        json={"context": {"final_script": "EXT. PARK - DAY"}, "system_prompt": ""},
    )
    assert post_r.status_code == 200
    run_id = post_r.json()["run_id"]
    run_data = await _wait_for_run(client, run_id)
    assert run_data.get("run_id") == run_id


@pytest.mark.asyncio
async def test_get_run_bad_id_404(client: AsyncClient):
    r = await client.get("/runs/totally-nonexistent-run-id-abc123")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_runs_empty(client: AsyncClient):
    r = await client.get("/runs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_list_runs_after_trigger(client: AsyncClient):
    post_r = await client.post(
        "/agents/orch.showrunner/run",
        json={"context": {"final_script": "INT. STUDIO - DAY"}, "system_prompt": ""},
    )
    run_id = post_r.json()["run_id"]
    await _wait_for_run(client, run_id)
    r = await client.get("/runs")
    assert r.status_code == 200
    run_ids = [x["run_id"] for x in r.json()]
    assert run_id in run_ids


@pytest.mark.asyncio
async def test_metrics_returns_snapshot(client: AsyncClient):
    r = await client.get("/metrics")
    assert r.status_code == 200
    data = r.json()
    assert "total_runs" in data
    assert "done" in data
    assert "failed" in data


@pytest.mark.asyncio
async def test_sse_stream_delivers_events(client: AsyncClient):
    post_r = await client.post(
        "/agents/orch.showrunner/run",
        json={"context": {"final_script": "EXT. BEACH - DAY"}, "system_prompt": ""},
    )
    assert post_r.status_code == 200
    run_id = post_r.json()["run_id"]

    events = []
    async with client.stream("GET", f"/runs/{run_id}/stream") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
            if "done" in events:
                break

    assert "done" in events
