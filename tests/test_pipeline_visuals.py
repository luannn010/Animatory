# tests/test_pipeline_visuals.py
from __future__ import annotations

import asyncio
import json

import pytest

from animatory import entity_registry as er
from animatory import visual_inference as vi


def _seed_episode(tmp_path):
    ep = tmp_path / "C001"
    ep.mkdir()
    (ep / "manifest.json").write_text(
        json.dumps({"chunks": [], "chunk_count": 0}), encoding="utf-8")
    reg = er.EntityRegistry(
        episode_id="C001",
        characters=[{"canonical": "Từ An", "aliases": [], "appears_in": ["C001_S01"],
                     "description": {"summary": "a censor"}, "voice": er.empty_voice(),
                     "generated": True}],
        locations=[{"canonical": "Phòng công chúa", "aliases": [], "appears_in": ["C001_S01"],
                    "description": {"summary": "a silk chamber"}, "generated": True}],
    )
    er.save(reg, ep, now="2026-06-18T00:00:00Z")
    return ep


@pytest.mark.asyncio
async def test_infer_visuals_runs_then_character_prompts_returns_both(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    ep = _seed_episode(tmp_path)

    async def fake(prompt, *, label, **kw):
        if label.startswith("visual/loc/"):
            return {"setting": {"value": "ornate hall", "source": "inferred"}}
        return {"hair": {"value": "topknot", "source": "inferred"}}

    monkeypatch.setattr(vi, "_default_call_fn", lambda: fake)

    r = await client.post("/pipeline/episodes/C001/infer-visuals")
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    rec = None
    for _ in range(100):
        rec = (await client.get(f"/runs/{run_id}")).json()
        if rec["status"] in ("done", "failed"):
            break
        await asyncio.sleep(0.02)
    assert rec is not None and rec["status"] == "done"

    # the pass streamed a visual_inferred event and persisted visual blocks
    assert any(ev["type"] == "visual_inferred" for ev in (rec.get("events") or []))
    reloaded = er.load("C001", ep)
    assert reloaded.characters[0]["visual"]["hair"]["value"] == "topknot"

    cp = await client.get("/pipeline/episodes/C001/character-prompts")
    assert cp.status_code == 200
    body = cp.json()
    assert body["character_prompts"]["characters"][0]["name"] == "Từ An"
    assert "topknot" in body["character_prompts"]["characters"][0]["positive"]
    assert body["location_prompts"]["locations"][0]["name"] == "Phòng công chúa"


@pytest.mark.asyncio
async def test_infer_visuals_404_when_not_chunked(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.post("/pipeline/episodes/NOPE/infer-visuals")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_character_prompts_404_when_not_chunked(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.get("/pipeline/episodes/NOPE/character-prompts")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_infer_visuals_run_fails_when_inference_raises(client, tmp_path, monkeypatch):
    # If inference blows up, the run must transition to 'failed' with an error set —
    # never left stuck in 'running'.
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    _seed_episode(tmp_path)

    async def boom(*args, **kwargs):
        raise RuntimeError("inference blew up")

    monkeypatch.setattr(vi, "infer_visuals", boom)

    r = await client.post("/pipeline/episodes/C001/infer-visuals")
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    rec = None
    for _ in range(100):
        rec = (await client.get(f"/runs/{run_id}")).json()
        if rec["status"] in ("done", "failed"):
            break
        await asyncio.sleep(0.02)
    assert rec is not None and rec["status"] == "failed"
    assert rec.get("error")  # error populated, not stuck in 'running'
