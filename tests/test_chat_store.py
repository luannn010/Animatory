# tests/test_chat_store.py
from __future__ import annotations
import pytest
import pytest_asyncio
from animatory.chat.store import InMemoryChatStore


@pytest_asyncio.fixture
async def store():
    s = InMemoryChatStore()
    await s.init()
    return s


@pytest.mark.asyncio
async def test_create_and_list_newest_first(store):
    a = await store.create_session("ep1", "C001", now="2026-06-04T00:00:01Z")
    b = await store.create_session("ep1", "C001", now="2026-06-04T00:00:02Z")
    sessions = await store.list_sessions("ep1", "C001")
    assert [s["session_id"] for s in sessions] == [b["session_id"], a["session_id"]]
    assert sessions[0]["message_count"] == 0
    assert sessions[0]["title"] is None


@pytest.mark.asyncio
async def test_append_messages_and_get(store):
    s = await store.create_session("ep1", "C001", now="2026-06-04T00:00:01Z")
    sid = s["session_id"]
    await store.append_message(sid, "user", "hi", None, now="2026-06-04T00:00:02Z")
    await store.append_message(sid, "assistant", "hello", [{"kind": "scene_edits", "payload": {"scene_id": "C001_S01"}}], now="2026-06-04T00:00:03Z")
    msgs = await store.get_messages(sid)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["tool_calls"][0]["kind"] == "scene_edits"
    sess = await store.get_session(sid)
    assert sess["message_count"] == 2
    assert sess["updated_at"] == "2026-06-04T00:00:03Z"  # bumped by append


@pytest.mark.asyncio
async def test_latest_title_tokens_and_delete(store):
    s1 = await store.create_session("ep1", "C001", now="2026-06-04T00:00:01Z")
    s2 = await store.create_session("ep1", "C001", now="2026-06-04T00:00:02Z")
    assert (await store.latest_session("ep1", "C001"))["session_id"] == s2["session_id"]

    await store.set_title(s1["session_id"], "My Chat", now="2026-06-04T00:00:05Z")
    await store.set_token_count(s1["session_id"], 1234, now="2026-06-04T00:00:06Z")
    got = await store.get_session(s1["session_id"])
    assert got["title"] == "My Chat"
    assert got["token_count"] == 1234

    await store.append_message(s1["session_id"], "user", "x", None, now="2026-06-04T00:00:07Z")
    await store.delete_session(s1["session_id"])
    assert await store.get_session(s1["session_id"]) is None
    assert await store.get_messages(s1["session_id"]) == []
    assert [s["session_id"] for s in await store.list_sessions("ep1", "C001")] == [s2["session_id"]]
