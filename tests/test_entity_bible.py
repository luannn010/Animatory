"""Tests for the Entity Bible: items roster on EntityRegistry + LLM item extractor.

The LLM call is injected (``chat_fn``) so these run with no network/GPU.
"""

from __future__ import annotations

import json

import pytest

from animatory.entity_registry import EntityRegistry
from animatory.item_extractor import extract_recurring_items

SHOTS = [
    {"id": "001", "action": "Rusty hammers a glowing bolt on the anvil. Sparks scatter."},
    {"id": "002", "action": "Rusty wipes his brow and reaches for the rusted key."},
    {"id": "003", "action": "The glowing bolt cracks with a sharp snap."},
    {"id": "004", "action": "He pockets the rusted key and stands."},
    {"id": "005", "action": "Wide on the empty workshop at dawn."},
]


def _fake_chat(returned_items):
    """Build an async chat_fn that returns a canned JSON item list."""
    async def chat_fn(messages, model, chat_url):
        return json.dumps({"items": returned_items})
    return chat_fn


@pytest.mark.asyncio
async def test_recurring_items_kept_with_verified_appears_in():
    chat_fn = _fake_chat([
        {"name": "glowing bolt", "aliases": [], "description": "a hot glowing metal bolt"},
        {"name": "rusted key", "aliases": ["the key"], "description": "an old iron key"},
    ])
    items = await extract_recurring_items(SHOTS, min_shots=2, chat_fn=chat_fn)
    by_name = {i["name"]: i for i in items}
    assert "glowing bolt" in by_name
    assert "rusted key" in by_name
    # appears_in is verified against the shot text, not the model's say-so.
    assert by_name["glowing bolt"]["appears_in"] == ["001", "003"]
    assert len(by_name["rusted key"]["appears_in"]) >= 2


@pytest.mark.asyncio
async def test_single_shot_and_hallucinated_items_dropped():
    chat_fn = _fake_chat([
        {"name": "anvil", "aliases": []},          # appears only in shot 001 → below threshold
        {"name": "magic sword", "aliases": []},    # appears in NO shot → hallucinated
    ])
    items = await extract_recurring_items(SHOTS, min_shots=2, chat_fn=chat_fn)
    names = {i["name"] for i in items}
    assert "anvil" not in names
    assert "magic sword" not in names


@pytest.mark.asyncio
async def test_no_actions_returns_empty():
    chat_fn = _fake_chat([{"name": "x"}])
    items = await extract_recurring_items([{"id": "1", "action": ""}], chat_fn=chat_fn)
    assert items == []


def test_learn_items_merges_and_persists(tmp_path):
    reg = EntityRegistry(episode_id="C001", characters=[{"canonical": "Rusty", "aliases": []}])
    reg.learn_items([
        {"name": "glowing bolt", "aliases": [], "appears_in": ["001", "003"]},
        {"name": "Rusty", "aliases": []},   # collides with a character → must NOT be filed as an item
        {"name": "glowing bolt", "aliases": []},  # duplicate → idempotent
    ])
    names = reg.known_names()["items"]
    assert names == ["glowing bolt"]
    # round-trips through the on-disk shape
    d = json.loads(json.dumps(reg.to_dict()))
    again = EntityRegistry.from_dict(d)
    assert again.known_names()["items"] == ["glowing bolt"]
    assert again.items[0]["appears_in"] == ["001", "003"]


def test_existing_learn_unaffected_by_items():
    reg = EntityRegistry(episode_id="C001")
    reg.learn([{"location": "Workshop", "characters": ["Rusty"], "dialogue": []}])
    assert reg.known_names()["characters"] == ["Rusty"]
    assert reg.known_names()["locations"] == ["Workshop"]
    assert reg.known_names()["items"] == []
