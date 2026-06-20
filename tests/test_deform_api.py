"""HTTP + SSE tests for the mesh-deform surface (no GPU).

Uses the shared ``client`` fixture (real app lifespan; DB_PATH=:memory:), so
``app.state.mesh_store`` / ``mesh_jobs`` are wired exactly as in production.
"""
from __future__ import annotations

import asyncio
import base64
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from animatory.deform.store import MeshJobStore

ASSET = "deform-demo"
BONES = [
    {"id": "top", "x": 100, "y": 80, "tipX": 100, "tipY": 150},
    {"id": "bottom", "x": 100, "y": 150, "tipX": 100, "tipY": 220},
]


def _ellipse_data_url(w: int = 200, h: int = 300) -> str:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((30, 30, w - 30, h - 30), fill=(180, 120, 90, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _gen_body(**over) -> dict:
    body = {"params": {"density": "coarse"}, "bones": BONES, "imageDataUrl": _ellipse_data_url()}
    body.update(over)
    return body


async def _generate_and_wait(client, asset: str = ASSET) -> dict:
    r = await client.post(f"/studio/assets/{asset}/mesh/generate", json=_gen_body())
    assert r.status_code == 202, r.text
    job_id = r.json()["jobId"]

    deadline = asyncio.get_event_loop().time() + 8.0
    body: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        jr = await client.get(f"/studio/assets/{asset}/mesh/jobs/{job_id}")
        body = jr.json()
        if body["status"] in ("done", "failed"):
            break
        await asyncio.sleep(0.05)
    assert body["status"] == "done", body
    return body


# -- store unit --------------------------------------------------------------------------

def test_meshjobstore_tracks_one_active_job_per_asset():
    s = MeshJobStore()
    job = s.create("a1")
    assert s.active("a1").job_id == job.job_id          # queued → in-flight
    s.update(job.job_id, status="done")
    assert s.active("a1") is None                       # terminal → no longer in-flight


# -- happy path --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_poll_and_get_mesh(client):
    await _generate_and_wait(client)

    m = await client.get(f"/studio/assets/{ASSET}/mesh")
    assert m.status_code == 200, m.text
    mesh = m.json()
    assert mesh["assetId"] == ASSET and mesh["status"] == "rigged"
    assert mesh["vertices"] and mesh["triangles"] and mesh["uvs"]
    assert set(mesh["bindPose"].keys()) == {"top", "bottom"}
    n_verts = len(mesh["vertices"]) // 2
    assert len(mesh["weights"]) == n_verts            # one weight per vertex
    assert mesh["version"] == 1


@pytest.mark.asyncio
async def test_sse_stream_emits_progress_then_done(client):
    r = await client.post("/studio/assets/sse-demo/mesh/generate", json=_gen_body())
    job_id = r.json()["jobId"]

    events: list[str] = []
    async with client.stream("GET", f"/studio/assets/sse-demo/mesh/jobs/{job_id}/stream") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            line = line.strip()
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
                if events[-1] in ("done", "error"):
                    break
    assert "progress" in events
    assert events[-1] == "done"


# -- saveWeights validation --------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_weights_roundtrip_and_validation(client):
    await _generate_and_wait(client, asset="weights-demo")
    mesh = (await client.get("/studio/assets/weights-demo/mesh")).json()
    n = len(mesh["vertices"]) // 2

    ok = {"weights": [{"bones": ["top"], "values": [1.0]} for _ in range(n)]}
    r = await client.put("/studio/assets/weights-demo/mesh/weights", json=ok)
    assert r.status_code == 200, r.text
    assert all(vw["bones"] == ["top"] for vw in r.json()["weights"])

    # wrong count
    bad_count = {"weights": [{"bones": ["top"], "values": [1.0]}]}
    assert (await client.put("/studio/assets/weights-demo/mesh/weights", json=bad_count)).status_code == 422

    # weights don't sum to 1
    bad_sum = {"weights": [{"bones": ["top"], "values": [0.5]} for _ in range(n)]}
    assert (await client.put("/studio/assets/weights-demo/mesh/weights", json=bad_sum)).status_code == 422

    # unknown bone id
    bad_bone = {"weights": [{"bones": ["ghost"], "values": [1.0]} for _ in range(n)]}
    assert (await client.put("/studio/assets/weights-demo/mesh/weights", json=bad_bone)).status_code == 422


# -- edge cases --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_mesh_404_when_absent(client):
    assert (await client.get("/studio/assets/never-meshed/mesh")).status_code == 404


@pytest.mark.asyncio
async def test_generate_requires_bones(client):
    r = await client.post("/studio/assets/x/mesh/generate", json=_gen_body(bones=[]))
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_generate_rejects_two_image_sources(client):
    r = await client.post(
        "/studio/assets/x/mesh/generate",
        json=_gen_body(imageRef="rig/whatever.png"),  # data URL + ref both present
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_then_404(client):
    await _generate_and_wait(client, asset="del-demo")
    assert (await client.delete("/studio/assets/del-demo/mesh")).status_code == 204
    assert (await client.get("/studio/assets/del-demo/mesh")).status_code == 404


@pytest.mark.asyncio
async def test_mesh_job_not_found(client):
    assert (await client.get("/studio/assets/x/mesh/jobs/nope")).status_code == 404
