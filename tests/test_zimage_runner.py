"""Runner tests with an injected fake engine (no torch/GPU)."""

from __future__ import annotations

import json
import warnings

from animatory.genimage.zimage.rig import Rig
from animatory.genimage.zimage.runner import run_batch
from animatory.genimage.zimage.shots import Shot


class _FakeImage:
    def save(self, path):  # noqa: D401
        from pathlib import Path
        Path(path).write_bytes(b"\x89PNG\r\n")  # token bytes so the panel file actually exists


class _FakeEngine:
    """Records attach/unload/generate so we can assert swap behavior and outputs."""

    class _Cfg:
        model = "fake-zimage"

    def __init__(self):
        self.config = self._Cfg()
        self.attaches: list[str] = []
        self.unloads = 0
        self.generated: list[tuple] = []

    def attach_lora(self, path, strength=0.9):
        self.attaches.append(path)

    def unload_lora(self):
        self.unloads += 1

    def generate(self, prompt, seed, *, width=512, height=768, negative="", **_):
        self.generated.append((prompt, seed, width, height))
        return _FakeImage(), (width, height)


def _rigs():
    return [
        Rig(name="rusty", kind="character", identity_mode="lora",
            lora_path="rusty.safetensors", trigger="rustychar", trained=True, fallback_seed=1),
        Rig(name="villain", kind="character", identity_mode="lora",
            lora_path="villain.safetensors", trigger="villainchar", trained=True, fallback_seed=2),
        Rig(name="workshop", kind="location", fallback_seed=100),
    ]


def test_panel_and_sidecar_written(tmp_path):
    shots = [Shot(id="001", action="hammers a bolt", characters=["rusty"], location="workshop")]
    eng = _FakeEngine()
    res = run_batch(shots, _rigs(), eng, out_dir=tmp_path, batch_id="b1")

    assert len(res.sidecars) == 1
    assert (tmp_path / "b1" / "panel_001.png").exists()
    sc = json.loads((tmp_path / "b1" / "panel_001.json").read_text(encoding="utf-8"))
    assert sc["rig"] == "rusty" and sc["trigger"] == "rustychar"
    assert "rustychar" in sc["prompt"]
    assert "background: workshop" in sc["prompt"]
    assert sc["model"] == "fake-zimage"


def test_lora_swaps_minimized_by_sorting(tmp_path):
    # Interleaved rigs; sort-by-rig means exactly one swap per character rig (acceptance #4).
    shots = [
        Shot(id="1", action="a", characters=["rusty"]),
        Shot(id="2", action="b", characters=["villain"]),
        Shot(id="3", action="c", characters=["rusty"]),
        Shot(id="4", action="d", characters=["villain"]),
    ]
    eng = _FakeEngine()
    res = run_batch(shots, _rigs(), eng, out_dir=tmp_path, batch_id="b2")
    assert res.lora_swaps == 2
    assert eng.attaches == ["rusty.safetensors", "villain.safetensors"]


def test_reference_mode_seed_is_locked(tmp_path):
    # Location-only shot → driver is the reference-mode location rig: locked seed, no LoRA.
    shots = [Shot(id="9", action="empty room at night", characters=[], location="workshop", seed=777)]
    eng = _FakeEngine()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = run_batch(shots, _rigs(), eng, out_dir=tmp_path, batch_id="b3")
    assert res.sidecars[0]["seed"] == 100  # locked, not the per-shot 777
    assert res.lora_swaps == 0
    assert eng.attaches == []
