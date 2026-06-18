# tests/test_parse_stream.py
"""parse_episode emits structured streaming events in phase order."""
from __future__ import annotations

import json

import pytest

from animatory.enrichment import entity_enrichment as ee
from animatory.parsing import entity_registry as er
from animatory.parsing.scene_parser import parse_episode


def _scene(cid: str) -> dict:
    return {
        "scene_id": f"{cid}_S01", "location": "Phòng", "characters": ["Từ An"],
        "shot_type": "medium", "action": "Từ An đứng.", "dialogue": [
            {"character": "Từ An", "line": "x", "emotion": "angry", "intensity": "high"},
        ], "narration": [], "mood": "",
    }


def _episode(tmp_path):
    ep_dir = tmp_path / "ep1"
    ep_dir.mkdir()
    (ep_dir / "C001.txt").write_text("body.", encoding="utf-8")
    (ep_dir / "manifest.json").write_text(json.dumps({
        "source_file": "ep1.txt", "chunk_count": 1,
        "chunks": [{"chunk_id": "C001", "file": "C001.txt", "char_start": 0, "char_end": 5}],
    }), encoding="utf-8")
    return ep_dir


@pytest.mark.asyncio
async def test_parse_episode_emits_streaming_events(tmp_path, monkeypatch):
    monkeypatch.setenv("QWEN_ENRICH_ENTITIES", "1")
    ep_dir = _episode(tmp_path)
    events: list[tuple[str, dict]] = []

    async def on_event(ev_type, payload):
        events.append((ev_type, payload))

    async def fake_parse_chunk(*, chunk_id, chunk_text, episode_id, output_dir, **kw):
        reg = er.load(episode_id, output_dir)
        scene = _scene(chunk_id)
        reg.learn([scene]); er.save(reg, output_dir, now="2026-06-04T00:00:00Z")
        p = output_dir / f"{chunk_id}_scenes.json"
        p.write_text(json.dumps({"chunk_id": chunk_id, "scenes": [scene]}, ensure_ascii=False), encoding="utf-8")
        return p

    async def fake_enrich(reg, scenes, *, call_fn, qwen, force=False, on_entity=None):
        reg.merge_descriptions("characters", "Từ An", description={"summary": "a censor"})
        if on_entity:
            await on_entity("characters", reg._find("characters", "Từ An"))
        reg.merge_descriptions("locations", "Phòng", description={"summary": "a room"})
        if on_entity:
            await on_entity("locations", reg._find("locations", "Phòng"))
        return reg

    async def fake_describe(scenes, *, call_fn, qwen):
        return {s["scene_id"]: "He stands." for s in scenes}

    monkeypatch.setattr(ee, "enrich_entities", fake_enrich)
    monkeypatch.setattr(ee, "describe_scenes", fake_describe)
    monkeypatch.setattr("animatory.parsing.scene_parser.parse_chunk", fake_parse_chunk)

    await parse_episode("ep1", ep_dir, on_event=on_event)

    types = [t for t, _ in events]
    # Phase order: scenes → chunk_parsed → voice_profiles → describing → entities → summaries → scene_summary
    assert types[0] == "phase" and events[0][1]["phase"] == "scenes"
    assert "chunk_parsed" in types
    assert types.index("chunk_parsed") < types.index("voice_profiles")
    assert types.index("voice_profiles") < types.index("entity_described")

    chunk_ev = next(p for t, p in events if t == "chunk_parsed")
    assert chunk_ev["chunk_id"] == "C001"
    assert chunk_ev["scenes"][0]["scene_id"] == "C001_S01"

    described = [p for t, p in events if t == "entity_described"]
    kinds = {p["kind"] for p in described}
    assert kinds == {"character", "location"}
    char_ev = next(p for p in described if p["kind"] == "character")
    assert char_ev["entry"]["description"]["summary"] == "a censor"

    voices = next(p for t, p in events if t == "voice_profiles")
    assert voices["profiles"][0]["character"] == "Từ An"

    summ = next(p for t, p in events if t == "scene_summary")
    assert summ == {"scene_id": "C001_S01", "summary": "He stands."}


@pytest.mark.asyncio
async def test_enrich_entities_fires_on_entity_per_entity():
    scenes = [_scene("C001")]
    reg = er.EntityRegistry(episode_id="ep1")
    reg.learn(scenes)
    seen: list[tuple[str, str]] = []

    async def fake_call(prompt, *, label, **kw):
        if label.startswith("enrich/loc/"):
            return {"summary": "", "setting": "", "lighting": "", "time_variants": []}
        return {"description": {"summary": "", "appearance": "", "attire": "",
                                "age_build": "", "palette": ""},
                "voice": {"register": "", "tone": "", "pace": ""}}

    async def on_entity(kind, entry):
        seen.append((kind, entry["canonical"]))

    await ee.enrich_entities(reg, scenes, call_fn=fake_call, qwen={}, on_entity=on_entity)
    assert ("locations", "Phòng") in seen
    assert ("characters", "Từ An") in seen
    # exactly one emission per known entity
    assert len(seen) == len(reg.characters) + len(reg.locations)
