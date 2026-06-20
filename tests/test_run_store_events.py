# tests/test_run_store_events.py
"""The structured `events` channel on RunRecord round-trips through the store."""
from __future__ import annotations

import pytest

from animatory.runtime.models import RunRecord
from animatory.runtime.run_store import InMemoryRunStore


@pytest.mark.asyncio
async def test_events_default_empty_and_round_trip():
    store = InMemoryRunStore()
    await store.init()
    await store.create(RunRecord(run_id="r1", agent_id="pipeline.parse.ep1"))

    fresh = await store.get("r1")
    assert fresh.events == []  # default

    events = [
        {"type": "phase", "payload": {"phase": "scenes", "total": 2}},
        {"type": "chunk_parsed", "payload": {"chunk_id": "C001", "scenes": [{"scene_id": "C001_S01"}]}},
    ]
    await store.update("r1", events=events)

    got = await store.get("r1")
    assert got.events == events
    assert got.events[1]["payload"]["chunk_id"] == "C001"


@pytest.mark.asyncio
async def test_events_append_pattern():
    # Mirrors how the parse route appends one event at a time.
    store = InMemoryRunStore()
    await store.init()
    await store.create(RunRecord(run_id="r2", agent_id="a"))

    for ev in ({"type": "phase", "payload": {}}, {"type": "entity_described", "payload": {"kind": "character"}}):
        rec = await store.get("r2")
        await store.update("r2", events=(rec.events or []) + [ev])

    got = await store.get("r2")
    assert [e["type"] for e in got.events] == ["phase", "entity_described"]
