# tests/test_chat_engine.py
from __future__ import annotations
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from animatory.chat_engine import stream_chat


def _sse_lines(chunks: list[dict]):
    lines = []
    for c in chunks:
        lines.append("data: " + json.dumps(c))
    lines.append("data: [DONE]")
    return lines


def _mock_stream(lines: list[str]):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()

    async def _aiter_lines():
        for ln in lines:
            yield ln
    resp.aiter_lines = _aiter_lines

    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=resp)
    stream_cm.__aexit__ = AsyncMock(return_value=False)

    client = MagicMock()
    client.stream = MagicMock(return_value=stream_cm)
    client_cm = MagicMock()
    client_cm.__aenter__ = AsyncMock(return_value=client)
    client_cm.__aexit__ = AsyncMock(return_value=False)
    return patch("animatory.chat_engine.httpx.AsyncClient", return_value=client_cm)


async def _collect(gen):
    return [ev async for ev in gen]


@pytest.mark.asyncio
async def test_stream_chat_emits_thinking_reply_usage_done():
    chunks = [
        {"choices": [{"delta": {"reasoning_content": "hmm "}}]},
        {"choices": [{"delta": {"content": "Hello"}}]},
        {"choices": [{"delta": {"content": " there"}}]},
        {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}},
    ]
    with _mock_stream(_sse_lines(chunks)):
        events = await _collect(stream_chat(
            chunk_id="C001", scene_index=[], mentioned_scenes=[], raw_text=None,
            messages=[{"role": "user", "content": "hi"}], thinking=True,
        ))
    kinds = [e["event"] for e in events]
    assert kinds == ["thinking", "reply", "reply", "usage", "done"]
    assert events[0]["data"]["delta"] == "hmm "
    assert events[1]["data"]["delta"] == "Hello"
    assert events[3]["data"]["prompt_tokens"] == 12
    assert events[3]["data"]["context_limit"] == 32768


@pytest.mark.asyncio
async def test_stream_chat_accumulates_tool_call_fragments():
    chunks = [
        {"choices": [{"delta": {"content": "On it."}}]},
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"name": "propose_scene_edits", "arguments": "{\"scene_id\":"}}]}}]},
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"arguments": "\"C001_S01\",\"changes\":{\"mood\":\"dark\"}}"}}]}}]},
    ]
    with _mock_stream(_sse_lines(chunks)):
        events = await _collect(stream_chat(
            chunk_id="C001", scene_index=[], mentioned_scenes=[], raw_text=None,
            messages=[{"role": "user", "content": "make S1 darker"}], thinking=False,
        ))
    tool = [e for e in events if e["event"] == "tool"]
    assert len(tool) == 1
    assert tool[0]["data"]["kind"] == "scene_edits"
    assert tool[0]["data"]["payload"]["scene_id"] == "C001_S01"
    assert tool[0]["data"]["payload"]["changes"]["mood"] == "dark"
    assert events[-1]["event"] == "done"


@pytest.mark.asyncio
async def test_stream_chat_emits_error_on_http_failure():
    import httpx
    resp = MagicMock()
    resp.raise_for_status = MagicMock(side_effect=httpx.ConnectError("boom"))
    async def _aiter_lines():
        if False:
            yield ""  # pragma: no cover
    resp.aiter_lines = _aiter_lines
    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=resp)
    stream_cm.__aexit__ = AsyncMock(return_value=False)
    client = MagicMock()
    client.stream = MagicMock(return_value=stream_cm)
    client_cm = MagicMock()
    client_cm.__aenter__ = AsyncMock(return_value=client)
    client_cm.__aexit__ = AsyncMock(return_value=False)
    with patch("animatory.chat_engine.httpx.AsyncClient", return_value=client_cm):
        events = await _collect(stream_chat(
            chunk_id="C001", scene_index=[], mentioned_scenes=[], raw_text=None,
            messages=[{"role": "user", "content": "hi"}], thinking=False,
        ))
    assert events[-1]["event"] == "error"
    assert "could not reach" in events[-1]["data"]["detail"]
