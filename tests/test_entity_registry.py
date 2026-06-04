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
    assert known == {"characters": ["Tư An"], "locations": ["Palace"]}
