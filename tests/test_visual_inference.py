# tests/test_visual_inference.py
from __future__ import annotations

import json

import pytest

from animatory import entity_registry as er
from animatory import visual_inference as vi


def _registry():
    return er.EntityRegistry(
        episode_id="ep1",
        characters=[
            {"canonical": "Từ An", "aliases": [], "appears_in": ["C001_S01", "C001_S02"],
             "description": {"summary": "a censor", "appearance": "lean", "attire": "",
                             "age_build": "young", "palette": "black"},
             "voice": {"register": "low", "tone": "dry", "pace": "measured",
                       "dominant_emotion": "mocking", "dominant_intensity": "medium",
                       "line_count": 9},
             "generated": True},
            {"canonical": "Lan Nhi", "aliases": [], "appears_in": ["C001_S01"],
             "description": {"summary": "", "appearance": "",
                             "attire": "white classical dress", "age_build": "", "palette": ""},
             "voice": er.empty_voice(), "generated": True},
        ],
        locations=[
            {"canonical": "Phòng công chúa", "aliases": [], "appears_in": ["C001_S01"],
             "description": {"summary": "a silk chamber", "setting": "silk drapes",
                             "lighting": "candlelit", "time_variants": ["night"]},
             "generated": True},
        ],
    )


def _char_visual():
    return {"face": {"value": "refined", "source": "inferred"},
            "eyes": {"value": "sharp phoenix eyes", "source": "inferred"},
            "hair": {"value": "long black topknot", "source": "inferred"},
            "attire": {"value": "embroidered silk daopao", "source": "inferred"},
            "palette": {"value": "black and silver", "source": "script"},
            "build": {"value": "slender", "source": "inferred"},
            "props": {"value": "folding fan", "source": "inferred"},
            "aura_vfx": {"value": "faint qi shimmer", "source": "inferred"}}


def _loc_visual():
    return {"setting": {"value": "ornate hall", "source": "inferred"},
            "architecture": {"value": "carved wood beams", "source": "inferred"},
            "props": {"value": "silk screens", "source": "inferred"},
            "lighting": {"value": "candlelit", "source": "script"},
            "atmosphere": {"value": "hushed", "source": "inferred"},
            "palette": {"value": "crimson and gold", "source": "inferred"},
            "time_of_day": {"value": "night", "source": "script"}}


# ── pure helpers ─────────────────────────────────────────────────────────────

def test_render_grounded_skips_empty_and_renders_lists():
    out = vi._render_grounded({"summary": "a censor", "appearance": "",
                               "attire": "robes", "time_variants": ["night", "day"]})
    assert "summary: a censor" in out
    assert "attire: robes" in out
    assert "appearance" not in out          # empty field skipped
    assert "night, day" in out              # list rendered


def test_coerce_visual_normalizes_bad_shapes():
    out = vi._coerce_visual(
        {"hair": "topknot",                          # bare string → default source
         "eyes": {"value": "phoenix"},               # missing source → inferred
         "attire": {"value": "robe", "source": "script"},
         "props": {"value": "fan", "source": "weird"},  # invalid source → inferred
         "ignored": {"value": "x", "source": "y"}},   # unknown field dropped
        er.CHAR_VISUAL_FIELDS,
    )
    assert out["hair"] == {"value": "topknot", "source": "inferred"}
    assert out["eyes"] == {"value": "phoenix", "source": "inferred"}
    assert out["attire"] == {"value": "robe", "source": "script"}
    assert out["props"] == {"value": "fan", "source": "inferred"}
    assert "ignored" not in out
    assert out["face"] == {"value": "", "source": ""}   # absent field → blank
    assert set(out) == set(er.CHAR_VISUAL_FIELDS)


def test_derive_role_heuristic():
    proto = {"voice": {"line_count": 20}, "appears_in": ["a", "b", "c"]}
    bg = {"voice": {"line_count": 0}, "appears_in": ["a"]}
    major = {"voice": {"line_count": 7}, "appears_in": ["a", "b"]}
    minor = {"voice": {"line_count": 1}, "appears_in": ["a", "b"]}
    assert vi._derive_role(proto, 20) == "protagonist"
    assert vi._derive_role(bg, 20) == "background"
    assert vi._derive_role(major, 20) == "supporting / major"
    assert vi._derive_role(minor, 20) == "supporting / minor"


# ── infer_visuals (mocked LLM) ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_infer_populates_visual_with_value_source():
    async def fake(prompt, *, label):
        return _loc_visual() if label.startswith("visual/loc/") else _char_visual()

    reg = _registry()
    await vi.infer_visuals(reg, call_fn=fake, qwen={})

    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an["visual"]["eyes"] == {"value": "sharp phoenix eyes", "source": "inferred"}
    assert tu_an["visual"]["palette"]["source"] == "script"
    # every field shaped {value, source}
    assert all(set(v) == {"value", "source"} for v in tu_an["visual"].values())

    chamber = next(e for e in reg.locations if e["canonical"] == "Phòng công chúa")
    assert chamber["visual"]["setting"]["value"] == "ornate hall"
    assert chamber["visual"]["time_of_day"] == {"value": "night", "source": "script"}


@pytest.mark.asyncio
async def test_infer_persists_role_on_characters():
    async def fake(prompt, *, label):
        return {} if label.startswith("visual/loc/") else _char_visual()

    reg = _registry()
    await vi.infer_visuals(reg, call_fn=fake, qwen={})
    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an["role"] == "protagonist"   # highest line_count in the episode


@pytest.mark.asyncio
async def test_infer_fill_empty_then_force():
    reg = _registry()
    tu = next(e for e in reg.characters if e["canonical"] == "Từ An")
    tu["visual"] = {**er.empty_visual("characters"),
                    "attire": {"value": "white robe", "source": "script"}}

    async def fake(prompt, *, label):
        if label.startswith("visual/loc/"):
            return {}
        return {"attire": {"value": "black daopao", "source": "inferred"},
                "hair": {"value": "topknot", "source": "inferred"}}

    await vi.infer_visuals(reg, call_fn=fake, qwen={})
    tu = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu["visual"]["attire"]["value"] == "white robe"   # non-empty → preserved
    assert tu["visual"]["hair"]["value"] == "topknot"        # empty → filled

    await vi.infer_visuals(reg, call_fn=fake, qwen={}, force=True)
    tu = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu["visual"]["attire"]["value"] == "black daopao"  # force overwrites


@pytest.mark.asyncio
async def test_roles_json_overrides_heuristic_and_injects_into_prompt(tmp_path):
    (tmp_path / "roles.json").write_text(
        json.dumps({"Từ An": "disgraced villain"}, ensure_ascii=False), encoding="utf-8")
    prompts = {}

    async def fake(prompt, *, label):
        prompts[label] = prompt
        return {} if label.startswith("visual/loc/") else _char_visual()

    reg = _registry()
    await vi.infer_visuals(reg, call_fn=fake, qwen={}, episode_dir=tmp_path)
    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an["role"] == "disgraced villain"               # roles.json wins
    assert "disgraced villain" in prompts["visual/char/Từ An"]  # steered the prompt


@pytest.mark.asyncio
async def test_infer_survives_one_failing_entity():
    # One entity's call raises; it is skipped (logged as a warning) without aborting
    # the run, so every other entity is still inferred. Mirrors the best-effort
    # contract in test_entity_enrichment.test_enrich_survives_one_failing_entity.
    async def fake(prompt, *, label):
        if "Từ An" in label:
            raise ValueError("qwen down")
        if label.startswith("visual/loc/"):
            return _loc_visual()
        return _char_visual()

    reg = _registry()
    await vi.infer_visuals(reg, call_fn=fake, qwen={})

    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an.get("visual", {}).get("hair", {}).get("value", "") == ""  # untouched
    lan = next(e for e in reg.characters if e["canonical"] == "Lan Nhi")
    assert lan["visual"]["hair"]["value"]                     # others still inferred
    chamber = next(e for e in reg.locations if e["canonical"] == "Phòng công chúa")
    assert chamber["visual"]["setting"]["value"] == "ornate hall"


@pytest.mark.asyncio
async def test_infer_invokes_on_entity_callback():
    seen = []

    async def fake(prompt, *, label):
        return {} if label.startswith("visual/loc/") else _char_visual()

    async def on_entity(kind, entry):
        seen.append((kind, entry["canonical"]))

    reg = _registry()
    await vi.infer_visuals(reg, call_fn=fake, qwen={}, on_entity=on_entity)
    assert ("characters", "Từ An") in seen
    assert ("locations", "Phòng công chúa") in seen
