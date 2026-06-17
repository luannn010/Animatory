# tests/test_entity_registry.py
from __future__ import annotations

import json

from animatory import entity_registry as er


def test_load_missing_returns_empty(tmp_path):
    reg = er.load("ep1", tmp_path)
    assert reg.episode_id == "ep1"
    assert reg.characters == []
    assert reg.locations == []


def test_save_then_load_round_trip(tmp_path):
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
        locations=[{"canonical": "Cao's Palace", "aliases": []}],
    )
    path = er.save(reg, tmp_path, now="2026-06-04T00:00:00Z")
    assert path == tmp_path / "entities.json"
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["updated_at"] == "2026-06-04T00:00:00Z"

    reloaded = er.load("ep1", tmp_path)
    assert reloaded.characters[0]["canonical"] == "Đại Càn"
    assert reloaded.locations[0]["canonical"] == "Cao's Palace"


def test_known_names_lists_canonicals(tmp_path):
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Tư An", "aliases": []}],
        locations=[{"canonical": "Palace", "aliases": []}],
    )
    known = reg.known_names()
    assert known == {"characters": ["Tư An"], "locations": ["Palace"], "items": []}


def _reg():
    return er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
        locations=[{"canonical": "Cao's Palace", "aliases": ["cao palace"]}],
    )


def test_normalize_scene_maps_alias_to_canonical():
    scene = {
        "scene_id": "C001_S01",
        "location": "cao palace",
        "characters": ["đại cản", "Tư An"],
        "dialogue": [
            {"character": "đại cản", "line": "Quỳ xuống.", "emotion": "commanding"},
        ],
        "action": "đại cản bước vào",  # free prose — must NOT be touched
    }
    out = _reg().normalize_scene(scene)
    assert out["location"] == "Cao's Palace"
    assert out["characters"] == ["Đại Càn", "Tư An"]
    assert out["dialogue"][0]["character"] == "Đại Càn"
    assert out["dialogue"][0]["emotion"] == "commanding"  # preserved
    assert out["action"] == "đại cản bước vào"  # prose untouched


def test_normalize_scene_is_case_insensitive_diacritic_significant():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Tư An", "aliases": []}],
    )
    scene = {"characters": ["TƯ AN", "Tu An"], "dialogue": [], "location": ""}
    out = reg.normalize_scene(scene)
    # "TƯ AN" matches canonical case-insensitively; "Tu An" (no diacritics) does not.
    assert out["characters"] == ["Tư An", "Tu An"]


def test_normalize_scene_does_not_mutate_input():
    scene = {"location": "cao palace", "characters": [], "dialogue": []}
    _reg().normalize_scene(scene)
    assert scene["location"] == "cao palace"


def test_learn_adds_new_names_only():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Tư An", "aliases": ["tu an"]}],
    )
    scenes = [
        {
            "location": "Garden",
            "characters": ["Tư An", "Lan Nhi"],   # Tư An known; Lan Nhi new
            "dialogue": [{"character": "tu an", "line": "x"},   # alias → known
                         {"character": "Bà Mối", "line": "y"}], # new via dialogue
        }
    ]
    reg.learn(scenes)
    char_canon = {e["canonical"] for e in reg.characters}
    loc_canon = {e["canonical"] for e in reg.locations}
    assert char_canon == {"Tư An", "Lan Nhi", "Bà Mối"}
    assert loc_canon == {"Garden"}


def test_learn_is_idempotent():
    reg = er.EntityRegistry(episode_id="ep1")
    scenes = [{"location": "Hall", "characters": ["A"], "dialogue": []}]
    reg.learn(scenes)
    reg.learn(scenes)
    assert len(reg.characters) == 1
    assert len(reg.locations) == 1


def test_learn_ignores_blank_names():
    reg = er.EntityRegistry(episode_id="ep1")
    reg.learn([{"location": "", "characters": ["", "  "], "dialogue": []}])
    assert reg.characters == []
    assert reg.locations == []
