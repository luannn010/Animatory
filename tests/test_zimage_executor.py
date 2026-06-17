"""ZImageExecutor orchestration tests (fake engine / no torch)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from animatory.executors.zimage import ZImageExecutor
from animatory.models import AgentDef, LayerEnum, RunRequest, StackEnum
from animatory.zimage.config import ZImageConfig


class _FakeImage:
    def save(self, path):
        Path(path).write_bytes(b"\x89PNG\r\n")


class _FakeEngine:
    class _Cfg:
        model = "fake-zimage"

    def __init__(self):
        self.config = self._Cfg()

    def attach_lora(self, *a, **k):
        pass

    def unload_lora(self):
        pass

    def generate(self, prompt, seed, *, width=512, height=768, negative="", **_):
        return _FakeImage(), (width, height)


def _agent(aid: str) -> AgentDef:
    return AgentDef(id=aid, layer=LayerEnum.execution, stack=StackEnum.image,
                    role="r", responsibility="x")


def _cfg(tmp_path) -> ZImageConfig:
    return ZImageConfig(rigs_dir=tmp_path / "rigs", out_dir=tmp_path / "out")


@pytest.mark.asyncio
async def test_build_rigs_writes_one_rig_json_per_entity(tmp_path):
    ex = ZImageExecutor(config=_cfg(tmp_path), engine=_FakeEngine())
    ctx = {"mode": "build_rigs", "rigs_dir": str(tmp_path / "rigs"), "entities": [
        {"name": "Rusty", "kind": "character", "identity_mode": "lora", "appears_in": ["001"]},
        {"name": "Workshop", "kind": "location"},
        {"name": "glowing bolt", "kind": "item", "appears_in": ["001", "003"]},
    ]}
    res = await ex.execute(RunRequest(context=ctx), _agent("design.rig"))

    assert res.error is None
    rig_files = [o for o in res.outputs if o.type == "file"]
    ref_imgs = [o for o in res.outputs if o.type == "image"]
    assert len(rig_files) == 3
    assert len(ref_imgs) == 3  # all reference-mode (LoRA untrained) → each gets a ref image
    assert res.metrics["rigs_built"] == 3
    # kinds land in kind-namespaced folders
    assert (tmp_path / "rigs" / "character" / "rusty" / "rig.json").exists()
    item_rig = json.loads((tmp_path / "rigs" / "item" / "glowing_bolt" / "rig.json").read_text(encoding="utf-8"))
    assert item_rig["kind"] == "item"
    assert item_rig["appears_in"] == ["001", "003"]


@pytest.mark.asyncio
async def test_build_rigs_without_engine_writes_json_only(tmp_path, monkeypatch):
    # Deps unavailable (forced, so the test is environment-independent) → rig.json
    # contracts still written, no reference images.
    import animatory.zimage.engine as zengine

    monkeypatch.setattr(zengine, "deps_available", lambda: False)
    ex = ZImageExecutor(config=_cfg(tmp_path), engine=None)
    ctx = {"mode": "build_rigs", "rigs_dir": str(tmp_path / "rigs"),
           "entities": [{"name": "Workshop", "kind": "location"}]}
    res = await ex.execute(RunRequest(context=ctx), _agent("design.rig"))
    assert res.error is None
    assert (tmp_path / "rigs" / "location" / "workshop" / "rig.json").exists()
    # engine unavailable → no reference image artifacts
    assert all(o.type == "file" for o in res.outputs)


@pytest.mark.asyncio
async def test_gen_panels_produces_one_artifact_per_shot(tmp_path):
    ex = ZImageExecutor(config=_cfg(tmp_path), engine=_FakeEngine())
    await ex.execute(RunRequest(context={
        "mode": "build_rigs", "rigs_dir": str(tmp_path / "rigs"),
        "entities": [{"name": "Rusty", "kind": "character"}, {"name": "Workshop", "kind": "location"}],
    }), _agent("design.rig"))

    ctx = {
        "mode": "gen_panels", "rigs_dir": str(tmp_path / "rigs"), "out_dir": str(tmp_path / "out"),
        "batch_id": "seq01", "scene_locations": {"0": "Workshop"},
        "shots": [
            {"id": "001", "sceneId": 0, "action": "hammers a bolt", "characters": ["Rusty"]},
            {"id": "002", "sceneId": 0, "action": "wipes his brow", "characters": ["Rusty"]},
        ],
    }
    res = await ex.execute(RunRequest(context=ctx), _agent("board.panels"))

    assert res.error is None
    assert len(res.outputs) == 2
    assert res.metrics["panels"] == 2
    assert all(o.type == "image" for o in res.outputs)
    assert (tmp_path / "out" / "seq01" / "panel_001.png").exists()
    assert (tmp_path / "out" / "seq01" / "panel_001.json").exists()
