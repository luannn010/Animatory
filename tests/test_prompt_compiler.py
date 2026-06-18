# tests/test_prompt_compiler.py
from __future__ import annotations

import json

from animatory import entity_registry as er
from animatory import prompt_compiler as pc


def _char():
    return {
        "canonical": "Từ An",
        "role": "protagonist",
        "generated": True,
        "visual": {
            "face": {"value": "refined sharp jaw", "source": "inferred"},
            "eyes": {"value": "sharp phoenix eyes", "source": "inferred"},
            "hair": {"value": "long black topknot", "source": "inferred"},
            "attire": {"value": "embroidered silk daopao", "source": "script"},
            "palette": {"value": "black and silver", "source": "inferred"},
            "build": {"value": "slender", "source": "inferred"},
            "props": {"value": "folding fan", "source": "inferred"},
            "aura_vfx": {"value": "faint qi shimmer", "source": "inferred"},
        },
    }


def _loc():
    return {
        "canonical": "Phòng công chúa",
        "generated": True,
        "visual": {
            "setting": {"value": "ornate princess chamber", "source": "script"},
            "architecture": {"value": "carved wood beams", "source": "inferred"},
            "props": {"value": "silk screens", "source": "inferred"},
            "lighting": {"value": "candlelit", "source": "script"},
            "atmosphere": {"value": "hushed", "source": "inferred"},
            "palette": {"value": "crimson and gold", "source": "inferred"},
            "time_of_day": {"value": "night", "source": "script"},
        },
    }


# ── characters ───────────────────────────────────────────────────────────────

def test_character_prompt_starts_with_style_and_names_subject():
    out = pc.build_character_prompt(_char())
    assert out["positive"].startswith(pc.STYLE_GLOBAL)
    assert "Từ An" in out["positive"]
    assert "a slender protagonist character named Từ An" in out["positive"]
    assert out["name"] == "Từ An"
    assert out["role"] == "protagonist"
    assert out["negative"] == pc.CHAR_NEGATIVE


def test_character_prompt_has_no_doubled_separators():
    out = pc.build_character_prompt(_char())
    pos = out["positive"]
    assert ", ," not in pos
    assert ",," not in pos
    assert not pos.strip().endswith(",")


def test_character_prompt_provenance_keys_and_values():
    prov = pc.build_character_prompt(_char())["provenance"]
    assert set(prov) <= set(er.CHAR_VISUAL_FIELDS)
    assert all(v in ("script", "inferred") for v in prov.values())
    assert prov["attire"] == "script"
    assert prov["eyes"] == "inferred"


def test_character_prompt_dedupes_repeated_values():
    e = {"canonical": "X", "visual": {
        "hair": {"value": "black silk", "source": "inferred"},
        "palette": {"value": "black silk", "source": "inferred"},
    }}
    out = pc.build_character_prompt(e)
    assert out["positive"].count("black silk") == 1


def test_character_prompt_robust_without_visual():
    out = pc.build_character_prompt({"canonical": "Từ An"})
    assert out["positive"].startswith(pc.STYLE_GLOBAL)
    assert "Từ An" in out["positive"]
    assert out["provenance"] == {}
    assert ", ," not in out["positive"]
    assert "role" not in out


# ── locations ────────────────────────────────────────────────────────────────

def test_location_prompt_shape():
    out = pc.build_location_prompt(_loc())
    assert out["positive"].startswith(pc.STYLE_GLOBAL)
    assert "Phòng công chúa" in out["positive"]
    assert out["name"] == "Phòng công chúa"
    assert out["negative"] == pc.LOC_NEGATIVE
    assert out["provenance"]["setting"] == "script"
    assert ", ," not in out["positive"]


# ── compile_episode ──────────────────────────────────────────────────────────

def test_compile_episode_writes_both_files(tmp_path):
    reg = er.EntityRegistry(episode_id="C001", characters=[_char()], locations=[_loc()])
    er.save(reg, tmp_path, now="2026-06-18T00:00:00Z")

    char_path, loc_path = pc.compile_episode("C001", tmp_path)
    assert char_path == tmp_path / "character_prompts.json"
    assert loc_path == tmp_path / "location_prompts.json"

    cdoc = json.loads(char_path.read_text(encoding="utf-8"))
    assert cdoc["episode_id"] == "C001"
    assert cdoc["generator"] == "zimage-turbo"
    assert cdoc["style_global"] == pc.STYLE_GLOBAL
    assert cdoc["characters"][0]["name"] == "Từ An"
    assert cdoc["characters"][0]["positive"].startswith(pc.STYLE_GLOBAL)

    ldoc = json.loads(loc_path.read_text(encoding="utf-8"))
    assert ldoc["locations"][0]["name"] == "Phòng công chúa"
    assert ldoc["locations"][0]["negative"] == pc.LOC_NEGATIVE
