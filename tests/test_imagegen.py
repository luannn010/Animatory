"""imagegen API tests (no torch/GPU) — BACKEND_SPEC.md acceptance criteria.

A fake engine is injected into ``run_job`` (and into the app for HTTP tests), so the brain
VRAM gate / pipeline release are skipped (those only fire for a real ``ZImageEngine``).
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path

import pytest

from animatory.imagegen.jobs import ImageJobStore
from animatory.imagegen.lora import LoraNotFound, LoraRegistry
from animatory.imagegen.presets import AssetType, apply_defaults, build_prompts
from animatory.imagegen.schemas import GenerationRequest, LoraConfig
from animatory.imagegen.service import run_job, run_train_job


# -- fakes ------------------------------------------------------------------------------

class _FakeImage:
    def save(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b"\x89PNG\r\n")


class _FakeEngine:
    """Records LoRA state and generate args so tests can assert behavior."""

    is_loaded = False

    def __init__(self):
        self.active_loras: list = []
        self.gen_calls: list[dict] = []
        self.loras_at_generate: list | None = None

    def attach_loras(self, specs):
        self.active_loras = list(specs)

    def unload_lora(self):
        self.active_loras = []

    def generate(self, prompt, seed, *, width=512, height=768, negative="",
                 steps=None, guidance_scale=None, **_):
        self.loras_at_generate = list(self.active_loras)
        self.gen_calls.append({
            "prompt": prompt, "seed": seed, "width": width, "height": height,
            "negative": negative, "steps": steps, "cfg": guidance_scale,
        })
        return _FakeImage(), (width, height)


async def _store() -> ImageJobStore:
    s = ImageJobStore(":memory:")
    await s.init()
    return s


def _req(**kw) -> GenerationRequest:
    kw.setdefault("asset_type", AssetType.RIG)
    kw.setdefault("prompt", "a hero")
    return GenerationRequest(**kw)


async def _run(store, engine, registry, req, tmp_path):
    job_id = "job-" + str(len(engine.gen_calls))
    await store.create(job_id, status="queued", asset_type=req.asset_type.value,
                       character_id=req.character_id, scene_id=req.scene_id)
    return await run_job(store, engine, registry, job_id, req, out_dir=str(tmp_path))


# -- enhance layer (acceptance 1, 3) ----------------------------------------------------

def test_build_prompts_appends_caller_negatives():
    pos, neg = build_prompts(_req(prompt="angry youth", negative_prompt="modern clothing"))
    assert pos.startswith("flat 2D toon")          # shared style spine leads every asset type
    assert "full body character design" in pos     # rig composition prefix
    assert "angry youth" in pos
    # preset base AND caller negative both present (appended, not replaced) — acceptance 3
    assert "deformed hands" in neg
    assert "photorealistic" in neg                 # realism actively excluded for all types
    assert "modern clothing" in neg


def test_shared_style_spine_across_asset_types():
    """rig and shot must share the same art-style spine so they don't drift toon-vs-realistic."""
    rig_pos, rig_neg = build_prompts(_req(asset_type=AssetType.RIG, prompt="x"))
    shot_pos, shot_neg = build_prompts(_req(asset_type=AssetType.SHOT, prompt="x"))
    assert rig_pos.startswith("flat 2D toon") and shot_pos.startswith("flat 2D toon")
    assert "photorealistic" in rig_neg and "photorealistic" in shot_neg


def test_apply_defaults_fills_only_unset():
    # rig with nothing set → preset portrait (acceptance 1)
    d = apply_defaults(_req())
    assert (d["width"], d["height"], d["steps"], d["cfg_scale"]) == (768, 1152, 8, 1.8)
    # caller override wins; the rest still preset
    d2 = apply_defaults(_req(width=512))
    assert d2["width"] == 512 and d2["height"] == 1152


def test_background_size_from_env(monkeypatch):
    d = apply_defaults(_req(asset_type=AssetType.BACKGROUND))
    assert (d["width"], d["height"]) == (1920, 1080)
    monkeypatch.setenv("IMAGEGEN_BG_WIDTH", "1280")
    monkeypatch.setenv("IMAGEGEN_BG_HEIGHT", "720")
    d2 = apply_defaults(_req(asset_type=AssetType.BACKGROUND))
    assert (d2["width"], d2["height"]) == (1280, 720)


# -- LoRA registry (acceptance 4, 9) ----------------------------------------------------

def test_lora_registry_resolve_and_unknown(tmp_path):
    (tmp_path / "tu_an_v1.safetensors").write_bytes(b"x")
    reg = LoraRegistry(tmp_path)
    assert reg.list_available() == ["tu_an_v1"]
    assert reg.resolve("tu_an_v1").endswith("tu_an_v1.safetensors")
    assert reg.resolve("tu_an_v1.safetensors").endswith("tu_an_v1.safetensors")  # ext tolerated
    with pytest.raises(LoraNotFound):
        reg.resolve("missing")


# -- run_job worker ---------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_job_rig_produces_portrait_png(tmp_path):
    store, engine = await _store(), _FakeEngine()
    rec = await _run(store, engine, LoraRegistry(tmp_path / "loras"), _req(), tmp_path)
    assert rec["status"] == "done"
    assert rec["meta"]["width"] == 768 and rec["meta"]["height"] == 1152  # acceptance 1
    assert rec["image_url"].startswith("/outputs/rig/")
    out = tmp_path / "rig" / f"{rec['job_id']}.png"
    assert out.exists()


@pytest.mark.asyncio
async def test_unknown_lora_fails_job_with_clear_error(tmp_path):
    store, engine = await _store(), _FakeEngine()
    req = _req(loras=[LoraConfig(name="nope")])
    rec = await _run(store, engine, LoraRegistry(tmp_path / "loras"), req, tmp_path)
    assert rec["status"] == "error"
    assert rec["error"].startswith("lora:")          # acceptance 4
    assert not engine.gen_calls                       # never reached the GPU


@pytest.mark.asyncio
async def test_loras_unloaded_between_jobs(tmp_path):
    (tmp_path / "tu.safetensors").write_bytes(b"x")
    reg = LoraRegistry(tmp_path)
    store, engine = await _store(), _FakeEngine()

    # job 1 uses a LoRA → present during generate, cleared afterwards
    await _run(store, engine, reg, _req(loras=[LoraConfig(name="tu", weight=0.7)]), tmp_path)
    assert engine.loras_at_generate and len(engine.loras_at_generate) == 1
    assert engine.active_loras == []                  # acceptance 5

    # job 2 uses no LoRA → must be unaffected by job 1
    await _run(store, engine, reg, _req(), tmp_path)
    assert engine.loras_at_generate == []             # acceptance 5


@pytest.mark.asyncio
async def test_seed_per_character_reused(tmp_path):
    store, engine = await _store(), _FakeEngine()
    reg = LoraRegistry(tmp_path / "loras")
    rec1 = await _run(store, engine, reg, _req(character_id="tu_an"), tmp_path)
    seed1 = rec1["seed"]
    assert await store.get_seed("tu_an") == seed1
    rec2 = await _run(store, engine, reg, _req(character_id="tu_an"), tmp_path)
    assert rec2["seed"] == seed1                       # acceptance 8


@pytest.mark.asyncio
async def test_explicit_seed_is_honored(tmp_path):
    store, engine = await _store(), _FakeEngine()
    rec = await _run(store, engine, LoraRegistry(tmp_path / "loras"),
                     _req(seed=12345), tmp_path)
    assert rec["seed"] == 12345
    assert engine.gen_calls[-1]["seed"] == 12345


@pytest.mark.asyncio
async def test_gpu_lock_serializes_jobs(tmp_path):
    """Two concurrent jobs must not generate at the same time (single-GPU mutex)."""
    store = await _store()
    reg = LoraRegistry(tmp_path / "loras")

    state = {"current": 0, "max": 0}
    guard = threading.Lock()

    class _ConcEngine(_FakeEngine):
        def generate(self, prompt, seed, **k):
            with guard:
                state["current"] += 1
                state["max"] = max(state["max"], state["current"])
            time.sleep(0.05)
            with guard:
                state["current"] -= 1
            return _FakeImage(), (k.get("width", 512), k.get("height", 768))

    engine = _ConcEngine()

    async def one(i):
        jid = f"c{i}"
        await store.create(jid, status="queued", asset_type="rig")
        return await run_job(store, engine, reg, jid, _req(), out_dir=str(tmp_path))

    await asyncio.gather(one(1), one(2))
    assert state["max"] == 1                           # acceptance 7


# -- HTTP surface (acceptance 9, 10) ----------------------------------------------------

@pytest.mark.asyncio
async def test_http_loras_and_healthz(client, tmp_path):
    from animatory.server import app

    (tmp_path / "a.safetensors").write_bytes(b"x")
    app.state.lora_registry = LoraRegistry(tmp_path)

    r = await client.get("/imagegen/loras")
    assert r.status_code == 200 and r.json() == ["a"]   # acceptance 9

    h = await client.get("/imagegen/healthz")
    assert h.status_code == 200
    body = h.json()
    assert body["ok"] is True and body["engine_loaded"] is False  # acceptance 10


@pytest.mark.asyncio
async def test_http_generate_roundtrip_and_assets(client, tmp_path):
    from animatory.server import app

    app.state.image_engine = _FakeEngine()
    app.state.lora_registry = LoraRegistry(tmp_path / "loras")
    app.state.image_out_dir = str(tmp_path)

    r = await client.post("/imagegen/generate", json={
        "asset_type": "rig", "prompt": "a young swordsman", "character_id": "tu_an",
    })
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    # poll until the background worker finishes
    deadline = asyncio.get_event_loop().time() + 5.0
    data = {}
    while asyncio.get_event_loop().time() < deadline:
        jr = await client.get(f"/imagegen/jobs/{job_id}")
        data = jr.json()
        if data["status"] in ("done", "error"):
            break
        await asyncio.sleep(0.05)

    assert data["status"] == "done", data
    assert data["image_url"] == f"/outputs/rig/{job_id}.png"

    a = await client.get("/imagegen/assets", params={"type": "rig", "character_id": "tu_an"})
    assert a.status_code == 200
    assert any(item["job_id"] == job_id for item in a.json())  # acceptance 9


@pytest.mark.asyncio
async def test_http_job_not_found(client):
    r = await client.get("/imagegen/jobs/does-not-exist")
    assert r.status_code == 404


# -- multi-LoRA apply (single-pass stacking) -------------------------------------------

@pytest.mark.asyncio
async def test_multi_lora_stacks_in_one_pass(tmp_path):
    (tmp_path / "a.safetensors").write_bytes(b"x")
    (tmp_path / "b.safetensors").write_bytes(b"x")
    reg = LoraRegistry(tmp_path)
    store, engine = await _store(), _FakeEngine()
    req = _req(loras=[LoraConfig(name="a", weight=0.9), LoraConfig(name="b", weight=0.5)])
    rec = await _run(store, engine, reg, req, tmp_path)
    assert rec["status"] == "done"
    # both LoRAs were attached together for the single generate (not phased)
    assert engine.loras_at_generate is not None and len(engine.loras_at_generate) == 2


# -- LoRA training job (subprocess mocked) ---------------------------------------------

def _train_cfg(tmp_path, **over):
    cfg = {
        "name": "biz_man", "refs_dir": str(tmp_path / "refs"), "steps": 50,
        "lora_dir": str(tmp_path / "loras"), "rigs_dir": str(tmp_path / "rigs"),
    }
    cfg.update(over)
    return cfg


@pytest.mark.asyncio
async def test_run_train_job_success(tmp_path, monkeypatch):
    monkeypatch.setenv("ZIMAGE_OUT_DIR", str(tmp_path / "out"))  # progress dir under tmp
    (tmp_path / "loras").mkdir()
    store = await _store()
    await store.create("t1", status="queued", asset_type="lora", character_id="biz_man")

    async def fake_run(cmd):
        pp = cmd[cmd.index("--progress") + 1]
        lora = Path(tmp_path / "loras" / "biz_man.safetensors")
        lora.write_bytes(b"x")  # the subprocess would write the real LoRA here
        Path(pp).write_text(json.dumps({
            "status": "done", "step": 50, "total": 50, "loss": 0.12,
            "lora_name": "biz_man", "lora_path": str(lora),
        }), encoding="utf-8")
        return 0, ""

    rec = await run_train_job(store, None, "t1", _train_cfg(tmp_path), run_cmd=fake_run, poll_s=0.01)
    assert rec["status"] == "done"
    assert rec["meta"]["lora_name"] == "biz_man"
    # trained LoRA is now resolvable by name from LORA_DIR
    assert "biz_man" in LoraRegistry(tmp_path / "loras").list_available()


@pytest.mark.asyncio
async def test_run_train_job_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("ZIMAGE_OUT_DIR", str(tmp_path / "out"))
    store = await _store()
    await store.create("t2", status="queued", asset_type="lora", character_id="biz_man")

    async def fake_fail(cmd):
        pp = cmd[cmd.index("--progress") + 1]
        Path(pp).write_text(json.dumps({"status": "error", "error": "no images found"}),
                            encoding="utf-8")
        return 1, "Traceback ..."

    rec = await run_train_job(store, None, "t2", _train_cfg(tmp_path), run_cmd=fake_fail, poll_s=0.01)
    assert rec["status"] == "error"
    assert "no images found" in rec["error"]


@pytest.mark.asyncio
async def test_http_train_endpoint(client, tmp_path, monkeypatch):
    from animatory.server import app
    import animatory.imagegen.router as r

    refs = tmp_path / "refs"
    refs.mkdir()
    (refs / "a.png").write_bytes(b"\x89PNG\r\n")
    app.state.lora_registry = LoraRegistry(tmp_path / "loras")

    async def fake_train(store, engine, job_id, cfg, **kw):
        await store.update(job_id, status="done", meta={
            "name": cfg["name"], "step": cfg["steps"], "total": cfg["steps"],
            "lora_name": cfg["name"], "loss": 0.1,
        })

    monkeypatch.setattr(r, "run_train_job", fake_train)

    resp = await client.post("/imagegen/loras/train",
                             json={"name": "hero", "refs_dir": str(refs), "steps": 10})
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]

    deadline = asyncio.get_event_loop().time() + 3.0
    body = {}
    while asyncio.get_event_loop().time() < deadline:
        body = (await client.get(f"/imagegen/trainings/{job_id}")).json()
        if body["status"] == "done":
            break
        await asyncio.sleep(0.02)
    assert body["status"] == "done" and body["name"] == "hero"


@pytest.mark.asyncio
async def test_http_train_no_images_400(client):
    r = await client.post("/imagegen/loras/train", json={"name": "nobody-xyz"})
    assert r.status_code == 400
