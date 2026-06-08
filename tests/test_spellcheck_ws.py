# tests/test_spellcheck_ws.py
from __future__ import annotations

import json
from unittest.mock import patch

from starlette.testclient import TestClient

from animatory.server import app
from animatory.spellcheck.checker import Finding


def _collect(ws):
    events = []
    while True:
        msg = json.loads(ws.receive_text())
        events.append(msg)
        if msg["type"] in ("complete", "error_fatal"):
            break
    return events


def test_ws_streams_chunk_then_naming_then_complete():
    # Each paragraph exceeds the 650-word target so it becomes its own segment.
    doc = "\n\n".join("Sarah went home. " * 250 for _ in range(6)) + "\n\nSara left."

    async def fake_check(segment_text, *, char_offset, known):
        return [Finding("spelling", "Sarh", "Sarah", char_offset, char_offset + 4, "typo")]

    with patch("animatory.spellcheck.router.check_segment", side_effect=fake_check):
        with TestClient(app) as c:
            with c.websocket_connect(
                "/pipeline/episodes/ep1/chunks/C001/spellcheck/ws"
            ) as ws:
                ws.send_text(json.dumps({"action": "start", "document": doc}))
                events = _collect(ws)

    types = [e["type"] for e in events]
    assert types[0] == "chunk_started"
    assert "chunk_findings" in types
    assert "naming_findings" in types
    assert types[-1] == "complete"
    started = next(e for e in events if e["type"] == "chunk_started")
    assert started["total_chunks"] >= 5


def test_one_failing_segment_emits_error_but_continues():
    doc = "\n\n".join("para " + "word " * 120 for _ in range(6))
    seen = {"n": 0}

    async def flaky_check(segment_text, *, char_offset, known):
        seen["n"] += 1
        if seen["n"] == 2:
            raise ValueError("could not parse JSON from Qwen response")
        return []

    with patch("animatory.spellcheck.router.check_segment", side_effect=flaky_check):
        with TestClient(app) as c:
            with c.websocket_connect(
                "/pipeline/episodes/ep1/chunks/C001/spellcheck/ws"
            ) as ws:
                ws.send_text(json.dumps({"action": "start", "document": doc}))
                events = _collect(ws)

    types = [e["type"] for e in events]
    assert "error" in types                 # the failing segment reported
    assert types[-1] == "complete"          # stream still finished
    err = next(e for e in events if e["type"] == "error")
    assert err["chunk_index"] == 1
