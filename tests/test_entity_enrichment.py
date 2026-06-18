# tests/test_entity_enrichment.py
from __future__ import annotations

import pytest

from animatory.enrichment import entity_enrichment as ee
from animatory.parsing import entity_registry as er


def _scenes():
    return [
        {
            "scene_id": "C001_S01",
            "location": "Phòng công chúa",
            "characters": ["Từ An", "Tiểu Lan Nhi"],
            "action": "Từ An bị trói trên giường, công chúa cầm kéo.",
            "narration": ["Căn phòng lụa là, nến lung linh trong đêm."],
            "mood": "tense",
            "dialogue": [
                {"character": "Từ An", "line": "Mỹ nhân nhận nhầm người rồi.",
                 "emotion": "mocking", "intensity": "medium"},
                {"character": "Tiểu Lan Nhi", "line": "Câm miệng.",
                 "emotion": "angry", "intensity": "high"},
            ],
        },
        {
            "scene_id": "C001_S02",
            "location": "Đường phố",
            "characters": ["Từ An"],
            "action": "Từ An sải bước trên phố giữa ban ngày.",
            "narration": [],
            "mood": "",
            "dialogue": [
                {"character": "Từ An", "line": "Về phủ thôi.",
                 "emotion": "neutral", "intensity": "low"},
            ],
        },
    ]


def _registry():
    reg = er.EntityRegistry(episode_id="ep1")
    reg.learn(_scenes())
    return reg


# ── appearance index ─────────────────────────────────────────────────────────

def test_appearance_index_maps_characters_with_evidence():
    idx = ee.build_appearance_index(_scenes())
    tu_an = next(c for c in idx["characters"] if c["name"] == "Từ An")
    assert tu_an["appears_in"] == ["C001_S01", "C001_S02"]
    assert "Mỹ nhân nhận nhầm" in tu_an["evidence"]   # own dialogue is evidence
    assert "sải bước trên phố" in tu_an["evidence"]    # action is evidence


def test_appearance_index_locations_and_skips_unknown():
    scenes = _scenes() + [{
        "scene_id": "C001_S03", "location": "Sảnh",
        "characters": [], "action": "x", "narration": [],
        "dialogue": [{"character": "Unknown", "line": "ai đó"}],
    }]
    idx = ee.build_appearance_index(scenes)
    loc_names = {l["name"] for l in idx["locations"]}
    assert {"Phòng công chúa", "Đường phố", "Sảnh"} <= loc_names
    assert "Unknown" not in {c["name"] for c in idx["characters"]}


def test_evidence_is_bounded(monkeypatch):
    monkeypatch.setattr(ee, "EVIDENCE_BUDGET", 40)
    big = {"scene_id": "C001_S01", "location": "L", "characters": ["A"],
           "action": "x" * 500, "narration": [], "dialogue": []}
    idx = ee.build_appearance_index([big])
    assert len(idx["characters"][0]["evidence"]) <= 42  # budget + ellipsis


# ── enrich_entities (mocked LLM) ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_enrich_fills_structured_fields_and_voice_stats():
    captured = []

    async def fake(prompt, *, label):
        captured.append(label)
        if label.startswith("enrich/loc/"):
            return {"summary": "a silk chamber", "setting": "silk drapes",
                    "lighting": "candlelit", "time_variants": ["night"]}
        return {"description": {"summary": "a young censor", "appearance": "lean",
                                "attire": "robes", "age_build": "young", "palette": "black"},
                "voice": {"register": "low", "tone": "dry", "pace": "measured"}}

    reg = _registry()
    await ee.enrich_entities(reg, _scenes(), call_fn=fake, qwen={})

    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an["description"]["appearance"] == "lean"
    assert tu_an["voice"]["register"] == "low"
    # voice stats come from aggregate(), not the LLM
    assert tu_an["voice"]["dominant_emotion"] == "mocking"
    assert tu_an["voice"]["line_count"] == 2
    assert tu_an["appears_in"] == ["C001_S01", "C001_S02"]

    chamber = next(e for e in reg.locations if e["canonical"] == "Phòng công chúa")
    assert chamber["description"]["lighting"] == "candlelit"
    assert chamber["description"]["time_variants"] == ["night"]


@pytest.mark.asyncio
async def test_enrich_keeps_empty_field_when_llm_is_silent():
    async def fake(prompt, *, label):
        if label.startswith("enrich/loc/"):
            return {"summary": "", "setting": "", "lighting": "", "time_variants": []}
        return {"description": {"summary": "", "appearance": "", "attire": "",
                                "age_build": "", "palette": ""},
                "voice": {"register": "", "tone": "", "pace": ""}}

    reg = _registry()
    await ee.enrich_entities(reg, _scenes(), call_fn=fake, qwen={})
    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an["description"]["appearance"] == ""   # no invention
    # but objective stats still populated
    assert tu_an["voice"]["line_count"] == 2


@pytest.mark.asyncio
async def test_enrich_does_not_overwrite_user_edited_entity():
    reg = _registry()
    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    tu_an["description"] = {**er.empty_description("characters"), "appearance": "HUMAN WROTE THIS"}
    tu_an["generated"] = False

    async def fake(prompt, *, label):
        if label.startswith("enrich/loc/"):
            return {"summary": "s", "setting": "", "lighting": "", "time_variants": []}
        return {"description": {"summary": "", "appearance": "machine", "attire": "",
                                "age_build": "", "palette": ""},
                "voice": {"register": "machine", "tone": "", "pace": ""}}

    await ee.enrich_entities(reg, _scenes(), call_fn=fake, qwen={})
    assert tu_an["description"]["appearance"] == "HUMAN WROTE THIS"  # preserved
    assert tu_an["voice"]["dominant_emotion"] == "mocking"          # stat still refreshed


@pytest.mark.asyncio
async def test_enrich_survives_one_failing_entity():
    async def fake(prompt, *, label):
        if "Phòng công chúa" in label:
            raise ValueError("qwen down")
        if label.startswith("enrich/loc/"):
            return {"summary": "ok", "setting": "", "lighting": "", "time_variants": []}
        return {"description": {"summary": "ok", "appearance": "", "attire": "",
                                "age_build": "", "palette": ""},
                "voice": {"register": "", "tone": "", "pace": ""}}

    reg = _registry()
    await ee.enrich_entities(reg, _scenes(), call_fn=fake, qwen={})
    # the failing location still gets appears_in; the rest enriches
    chamber = next(e for e in reg.locations if e["canonical"] == "Phòng công chúa")
    assert chamber["appears_in"] == ["C001_S01"]
    street = next(e for e in reg.locations if e["canonical"] == "Đường phố")
    assert street["description"]["summary"] == "ok"


# ── describe_scenes ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_describe_scenes_returns_summaries_for_known_ids_only():
    async def fake(prompt, *, label):
        return {"C001_S01": "Bound on the bed, scissors raised.",
                "C001_S02": "Walking the daylit street.",
                "C999_BOGUS": "should be dropped"}

    out = await ee.describe_scenes(_scenes(), call_fn=fake, qwen={})
    assert out == {
        "C001_S01": "Bound on the bed, scissors raised.",
        "C001_S02": "Walking the daylit street.",
    }


@pytest.mark.asyncio
async def test_describe_scenes_empty_on_failure():
    async def boom(prompt, *, label):
        raise ValueError("nope")
    assert await ee.describe_scenes(_scenes(), call_fn=boom, qwen={}) == {}
