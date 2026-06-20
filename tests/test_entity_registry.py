# tests/test_entity_registry.py
from __future__ import annotations

import json

from animatory.parsing import entity_registry as er


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


# ── descriptive enrichment ───────────────────────────────────────────────────


def test_old_names_only_registry_round_trips(tmp_path):
    # A registry written before descriptions existed must load unchanged.
    legacy = {
        "episode_id": "ep1",
        "updated_at": "2026-06-01T00:00:00Z",
        "characters": [{"canonical": "Từ An", "aliases": ["tu an"]}],
        "locations": [{"canonical": "Phòng công chúa", "aliases": []}],
    }
    (tmp_path / "entities.json").write_text(json.dumps(legacy, ensure_ascii=False), encoding="utf-8")
    reg = er.load("ep1", tmp_path)
    assert reg.characters[0]["canonical"] == "Từ An"
    assert "description" not in reg.characters[0]  # not forced on load


def test_description_blocks_round_trip(tmp_path):
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{
            "canonical": "Từ An", "aliases": [],
            "appears_in": ["C001_S01"],
            "description": {"summary": "a censor", "appearance": "lean",
                            "attire": "ink robes", "age_build": "young", "palette": "black"},
            "voice": {"register": "low", "tone": "dry", "pace": "measured",
                      "dominant_emotion": "mocking", "dominant_intensity": "medium", "line_count": 3},
            "generated": True,
        }],
    )
    er.save(reg, tmp_path, now="2026-06-04T00:00:00Z")
    reloaded = er.load("ep1", tmp_path)
    c = reloaded.characters[0]
    assert c["description"]["summary"] == "a censor"
    assert c["voice"]["register"] == "low"
    assert c["appears_in"] == ["C001_S01"]


def test_learn_keeps_existing_description():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "description": {"summary": "a censor"}, "generated": True}],
    )
    reg.learn([{"location": "Garden", "characters": ["Từ An", "Lan Nhi"], "dialogue": []}])
    tu_an = next(e for e in reg.characters if e["canonical"] == "Từ An")
    assert tu_an["description"]["summary"] == "a censor"  # untouched by learn


def test_merge_descriptions_fills_empty_only():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "description": {"summary": "a censor", "appearance": ""},
                     "generated": True}],
    )
    ok = reg.merge_descriptions(
        "characters", "từ an",
        description={"summary": "WRONG", "appearance": "lean and tall"},
        appears_in=["C001_S01"],
    )
    assert ok is True
    d = reg.characters[0]["description"]
    assert d["summary"] == "a censor"        # already set → preserved
    assert d["appearance"] == "lean and tall"  # was empty → filled
    assert reg.characters[0]["appears_in"] == ["C001_S01"]


def test_merge_descriptions_respects_user_edit():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "description": {"summary": "", "appearance": ""},
                     "voice": er.empty_voice(),
                     "generated": False}],  # human edited this entry
    )
    reg.merge_descriptions(
        "characters", "Từ An",
        description={"summary": "machine guess"},
        voice={"register": "machine", "dominant_emotion": "angry", "line_count": 5},
    )
    c = reg.characters[0]
    assert c["description"]["summary"] == ""          # authored field skipped
    assert c["voice"]["register"] == ""               # authored field skipped
    assert c["voice"]["dominant_emotion"] == "angry"  # objective stat still refreshes
    assert c["voice"]["line_count"] == 5


def test_merge_descriptions_force_overwrites():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "description": {"summary": "old"}, "generated": False}],
    )
    reg.merge_descriptions("characters", "Từ An", description={"summary": "new"}, force=True)
    assert reg.characters[0]["description"]["summary"] == "new"


def test_merge_descriptions_unknown_name_is_noop():
    reg = er.EntityRegistry(episode_id="ep1")
    assert reg.merge_descriptions("characters", "Nobody", description={"summary": "x"}) is False


# ── free-inference visual block ──────────────────────────────────────────────


def test_empty_visual_character_shape():
    v = er.empty_visual("characters")
    assert set(v) == set(er.CHAR_VISUAL_FIELDS)
    assert all(v[f] == {"value": "", "source": ""} for f in v)


def test_empty_visual_location_shape():
    v = er.empty_visual("locations")
    assert set(v) == set(er.LOC_VISUAL_FIELDS)
    assert all(v[f] == {"value": "", "source": ""} for f in v)


def test_merge_visual_fills_empty_only():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "visual": {"attire": {"value": "white dress", "source": "script"},
                                "hair": {"value": "", "source": ""}},
                     "generated": True}],
    )
    ok = reg.merge_visual(
        "characters", "từ an",
        visual={"attire": {"value": "WRONG", "source": "inferred"},
                "hair": {"value": "long black topknot", "source": "inferred"}},
    )
    assert ok is True
    v = reg.characters[0]["visual"]
    assert v["attire"] == {"value": "white dress", "source": "script"}   # set → preserved
    assert v["hair"] == {"value": "long black topknot", "source": "inferred"}  # empty → filled


def test_merge_visual_adds_missing_field():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [], "visual": {}, "generated": True}],
    )
    reg.merge_visual("characters", "Từ An",
                     visual={"eyes": {"value": "sharp phoenix eyes", "source": "inferred"}})
    assert reg.characters[0]["visual"]["eyes"]["value"] == "sharp phoenix eyes"


def test_merge_visual_respects_user_edit():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "visual": er.empty_visual("characters"),
                     "generated": False}],  # human edited this entry
    )
    reg.merge_visual("characters", "Từ An",
                     visual={"hair": {"value": "machine guess", "source": "inferred"}})
    assert reg.characters[0]["visual"]["hair"]["value"] == ""  # authored entry skipped


def test_merge_visual_force_overwrites():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "visual": {"attire": {"value": "old", "source": "script"}},
                     "generated": False}],
    )
    reg.merge_visual("characters", "Từ An",
                     visual={"attire": {"value": "new", "source": "inferred"}}, force=True)
    assert reg.characters[0]["visual"]["attire"] == {"value": "new", "source": "inferred"}


def test_merge_visual_unknown_name_is_noop():
    reg = er.EntityRegistry(episode_id="ep1")
    assert reg.merge_visual("characters", "Nobody",
                            visual={"hair": {"value": "x", "source": "inferred"}}) is False


def test_visual_block_round_trips(tmp_path):
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "visual": {"hair": {"value": "topknot", "source": "inferred"}},
                     "generated": True}],
    )
    er.save(reg, tmp_path, now="2026-06-04T00:00:00Z")
    reloaded = er.load("ep1", tmp_path)
    assert reloaded.characters[0]["visual"]["hair"]["value"] == "topknot"
