# tests/test_chat_engine.py
from __future__ import annotations
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from animatory.chat.engine import stream_chat, _build_messages


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
    return patch("animatory.chat.engine.httpx.AsyncClient", return_value=client_cm)


async def _collect(gen):
    return [ev async for ev in gen]


def test_build_messages_emits_single_leading_system_message():
    """Qwen's chat template rejects a 2nd system message ('System message must be
    at the beginning'). Context must be folded into one leading system turn."""
    msgs = _build_messages(
        scene_index=[{"scene_id": "C001_S03", "location": "sân", "characters": ["Tu An"]}],
        mentioned_scenes=[{"scene_id": "C001_S03", "dialogue": []}],
        raw_text="Trương An Thế bước vào.",
        messages=[{"role": "user", "content": "reparse scene 3"}],
        use_tools=True,
    )
    system_msgs = [m for m in msgs if m["role"] == "system"]
    assert len(system_msgs) == 1, f"expected 1 system message, got {len(system_msgs)}"
    assert msgs[0]["role"] == "system"
    # the folded system turn must still carry the scene index + raw text context
    assert "C001_S03" in msgs[0]["content"]
    assert "Trương An Thế" in msgs[0]["content"]
    # user turn is preserved after the system turn
    assert msgs[-1] == {"role": "user", "content": "reparse scene 3"}


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
    with patch("animatory.chat.engine.httpx.AsyncClient", return_value=client_cm):
        events = await _collect(stream_chat(
            chunk_id="C001", scene_index=[], mentioned_scenes=[], raw_text=None,
            messages=[{"role": "user", "content": "hi"}], thinking=False,
        ))
    assert events[-1]["event"] == "error"
    assert "could not reach" in events[-1]["data"]["detail"]


@pytest.mark.asyncio
async def test_stream_chat_fallback_parses_trailing_json(monkeypatch):
    monkeypatch.setenv("QWEN_TOOLS", "0")
    body = ('Sure, darkening it.\n```json\n'
            '{"scene_edits": [{"scene_id": "C001_S01", "changes": {"mood": "dark"}}],'
            ' "text_corrections": []}\n```')
    chunks = [{"choices": [{"delta": {"content": body}}]}]
    with _mock_stream(_sse_lines(chunks)):
        events = await _collect(stream_chat(
            chunk_id="C001", scene_index=[], mentioned_scenes=[], raw_text=None,
            messages=[{"role": "user", "content": "make S1 darker"}], thinking=False,
        ))
    reply_text = "".join(e["data"]["delta"] for e in events if e["event"] == "reply")
    assert "```json" not in reply_text
    tools = [e for e in events if e["event"] == "tool"]
    assert len(tools) == 1
    assert tools[0]["data"]["kind"] == "scene_edits"
    assert tools[0]["data"]["payload"]["scene_id"] == "C001_S01"
    assert events[-1]["event"] == "done"


@pytest.mark.asyncio
async def test_generate_title_uses_llm():
    from animatory.chat.engine import generate_title
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"choices": [{"message": {"content": '"Bedroom Standoff"'}}]}
    with patch("animatory.chat.engine.httpx.AsyncClient") as MockClient:
        inst = AsyncMock()
        inst.__aenter__ = AsyncMock(return_value=inst)
        inst.__aexit__ = AsyncMock(return_value=False)
        inst.post = AsyncMock(return_value=resp)
        MockClient.return_value = inst
        title = await generate_title([{"role": "user", "content": "describe scene 1"}])
    assert title == "Bedroom Standoff"  # quotes stripped


@pytest.mark.asyncio
async def test_generate_title_falls_back_on_error():
    from animatory.chat.engine import generate_title
    import httpx
    with patch("animatory.chat.engine.httpx.AsyncClient") as MockClient:
        inst = AsyncMock()
        inst.__aenter__ = AsyncMock(return_value=inst)
        inst.__aexit__ = AsyncMock(return_value=False)
        inst.post = AsyncMock(side_effect=httpx.ConnectError("down"))
        MockClient.return_value = inst
        title = await generate_title([{"role": "user", "content": "Make the mood darker please and tighten dialogue everywhere"}])
    assert title == "Make the mood darker please and tighten "  # first 40 chars of first user msg


def test_build_messages_injects_source_passage_for_mentioned_scene():
    msgs = _build_messages(
        scene_index=[{"scene_id": "C001_S03", "location": "Phố", "characters": ["Tu An"]}],
        mentioned_scenes=[{"scene_id": "C001_S03", "dialogue": []}],
        raw_text=None,
        messages=[{"role": "user", "content": "fix scene 3"}],
        use_tools=True,
        scene_sources={"C001_S03": "Tu An chạy trốn khỏi phủ công chúa."},
    )
    system_msgs = [m for m in msgs if m["role"] == "system"]
    assert len(system_msgs) == 1                      # still exactly one leading system turn
    assert "Source passage for C001_S03" in msgs[0]["content"]
    assert "Tu An chạy trốn" in msgs[0]["content"]


def test_build_messages_skips_empty_source_passage():
    msgs = _build_messages(
        scene_index=[], mentioned_scenes=[{"scene_id": "C001_S03"}], raw_text=None,
        messages=[{"role": "user", "content": "hi"}], use_tools=True,
        scene_sources={"C001_S03": ""},               # no match found -> no block
    )
    assert "Source passage" not in msgs[0]["content"]
