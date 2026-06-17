"""Unit tests for the generalized rig contract (no GPU / torch required)."""

from __future__ import annotations

import warnings
from pathlib import Path

import pytest

from animatory.zimage.rig import KIND_STYLE_DEFAULTS, KINDS, Rig

RIGS = Path(__file__).resolve().parent / "fixtures" / "rigs"
SAMPLES = {
    "character": RIGS / "character" / "rusty" / "rig.json",
    "location": RIGS / "location" / "workshop" / "rig.json",
    "item": RIGS / "item" / "glowing_bolt" / "rig.json",
}


@pytest.mark.parametrize("kind", KINDS)
def test_sample_rig_loads_and_fills_kind_defaults(kind):
    rig = Rig.load(SAMPLES[kind])
    assert rig.kind == kind
    # style_defaults is completed from the kind defaults (size + distilled invariants).
    sd = rig.style_defaults
    assert sd["steps"] == 9
    assert sd["guidance_scale"] == 0.0
    assert sd["scheduler"] == "FlowMatchEulerDiscrete"
    assert sd["width"] == KIND_STYLE_DEFAULTS[kind]["width"]
    assert sd["height"] == KIND_STYLE_DEFAULTS[kind]["height"]


def test_invalid_kind_rejected():
    with pytest.raises(ValueError):
        Rig(name="x", kind="vehicle")


def test_invalid_identity_mode_rejected():
    with pytest.raises(ValueError):
        Rig(name="x", kind="item", identity_mode="magic")


def test_untrained_lora_rig_falls_back_to_reference():
    rig = Rig.load(SAMPLES["character"])  # identity_mode lora but trained=false
    assert rig.identity_mode == "lora"
    assert rig.uses_lora is False  # not trained → cannot drive identity via LoRA
    ident = rig.resolve_identity()
    assert ident["mode"] == "reference"
    assert ident["seed"] == 12345


def test_trained_lora_rig_uses_trigger_and_free_seed():
    rig = Rig(name="hero", kind="character", identity_mode="lora",
              lora_path="x.safetensors", trigger="herochar", trained=True, fallback_seed=7)
    assert rig.uses_lora is True
    assert rig.build_prompt("running through rain").startswith("herochar,")
    # LoRA carries identity, so a per-shot seed is honored.
    assert rig.resolve_seed(999) == 999


def test_reference_mode_locks_seed_and_warns_on_override():
    rig = Rig.load(SAMPLES["location"])
    assert rig.resolve_seed(None) == 24680
    with pytest.warns(UserWarning):
        seed = rig.resolve_seed(555)  # attempt to override locked seed
    assert seed == 24680  # override ignored — locked seed wins (acceptance #5)


def test_build_prompt_is_short_and_identity_led():
    rig = Rig.load(SAMPLES["item"])  # reference mode → identity is the name
    prompt = rig.build_prompt("resting on the anvil")
    assert prompt.startswith("glowing bolt,")
    assert "resting on the anvil" in prompt
    assert "prop sheet" in prompt  # style tokens appended
    # identity + style come from the rig; only the action is per-shot.
    assert prompt.count(",") <= 6


def test_roundtrip_save_load(tmp_path):
    rig = Rig.new("tieu lan nhi", "character", fallback_seed=42, appears_in=["007"])
    p = rig.save(tmp_path / "rig.json")
    again = Rig.load(p)
    assert again.name == "tieu lan nhi"
    assert again.trigger == "tieulannhichar"
    assert again.appears_in == ["007"]
    assert again.style_defaults["height"] == 768  # character portrait
