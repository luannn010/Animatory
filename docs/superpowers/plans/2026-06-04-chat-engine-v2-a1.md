# Chat Engine v2 — A1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle JSON-only refine chat with a streaming, tool-calling chat: the model converses in prose and proposes edits only via tool calls, with live thinking, @-mention context, and a 32k usage meter.

**Architecture:** A new `animatory/chat_engine.py` streams from Qwen (`stream:true` + `tools`) and yields ordered events; a `POST …/chat/stream` route relays them as SSE (`EventSourceResponse`). The frontend reads the SSE with `fetch`+ReadableStream (EventSource is GET-only), renders streaming reply/thinking, and routes tool calls to the existing accept/reject card banners. The old synchronous `/refine` + `scene_refiner.py` are removed.

**Tech Stack:** Python 3.11 / FastAPI / httpx streaming / sse-starlette / pytest (backend); React 18 / TypeScript / Tailwind / Vitest (frontend).

**Spec:** [`docs/superpowers/specs/2026-06-04-chat-engine-v2-a1-design.md`](../specs/2026-06-04-chat-engine-v2-a1-design.md)

---

## File Structure

**Backend**
- Create `animatory/chat_engine.py` — `stream_chat()` async generator: prose/thinking/tool/usage events from a streamed Qwen response (tools mode + trailing-JSON fallback).
- Modify `animatory/pipeline_router.py` — add `POST …/chat/stream` (EventSourceResponse) + request models + mention validation + context assembly; **remove** `/refine`, `RefineRequest`, `ChatMessageModel`, and the `scene_refiner` import.
- Delete `animatory/scene_refiner.py`, `tests/test_scene_refiner.py`.
- Modify `tests/test_pipeline_api.py` — remove `/refine` tests; add `/chat/stream` tests.
- Create `tests/test_chat_engine.py`.

**Frontend**
- Create `frontend/src/api/chat.ts` — `parseSSE()` + `streamChat()` + types.
- Create `frontend/src/components/refine/mentions.ts` — `parseMentions()`.
- Modify `frontend/src/api/pipeline.ts` — remove `refineChat` + `RefineResult` (keep `ChatMessage`, `ScenePatch`, `TextCorrection`).
- Rewrite `frontend/src/components/refine/RefineChat.tsx` — streaming chat, thinking toggle, mention autocomplete, context ring, abort/retry, new chat.
- Modify `frontend/src/studio/views/ChapterView.tsx` — drive `streamChat`, route tool events to existing proposal/correction state, drop the Text/Scenes target toggle.
- Create `frontend/src/api/chat.test.ts`, `frontend/src/components/refine/mentions.test.ts`.

**Conventions:** backend tests use the `client` fixture + `monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))`; LLM always mocked. Frontend: API only via `src/api/*`; one accent `#3772cf`; tokens only; run `ui-taste` before JSX.

---

## Task 1: `chat_engine.stream_chat` — tools mode

**Files:**
- Create: `animatory/chat_engine.py`
- Test: `tests/test_chat_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_engine.py
from __future__ import annotations
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from animatory.chat_engine import stream_chat


def _sse_lines(chunks: list[dict]):
    """Build the list of `data: {...}` lines a streamed completion would emit."""
    lines = []
    for c in chunks:
        lines.append("data: " + json.dumps(c))
    lines.append("data: [DONE]")
    return lines


def _mock_stream(lines: list[str]):
    """Patch httpx.AsyncClient so client.stream(...) yields `lines` via aiter_lines."""
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'animatory.chat_engine'`

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/chat_engine.py
from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)

_SYSTEM = """\
You are a Vietnamese novel-to-animation production assistant helping refine ONE
chapter's shot list. Chat naturally in prose. When — and only when — the user
asks you to change something, call a tool:
- propose_scene_edits: edit ONE existing scene (include only the fields to change)
- propose_text_corrections: fix the raw chapter text (find/replace)
Never call a tool just to answer a question."""

_TOOLS = [
    {"type": "function", "function": {
        "name": "propose_scene_edits",
        "description": "Propose edits to ONE existing scene. Include only fields to change.",
        "parameters": {"type": "object", "required": ["scene_id", "changes"], "properties": {
            "scene_id": {"type": "string"},
            "changes": {"type": "object", "properties": {
                "location": {"type": "string"},
                "characters": {"type": "array", "items": {"type": "string"}},
                "shot_type": {"type": "string"},
                "action": {"type": "string"},
                "mood": {"type": "string"},
                "dialogue": {"type": "array", "items": {"type": "object", "properties": {
                    "character": {"type": "string"}, "line": {"type": "string"}}}},
            }},
            "rationale": {"type": "string"},
        }}}},
    {"type": "function", "function": {
        "name": "propose_text_corrections",
        "description": "Propose find/replace fixes to the raw chapter text.",
        "parameters": {"type": "object", "required": ["corrections"], "properties": {
            "corrections": {"type": "array", "items": {"type": "object",
                "required": ["find", "replace"], "properties": {
                    "find": {"type": "string"}, "replace": {"type": "string"},
                    "rationale": {"type": "string"}, "all_occurrences": {"type": "boolean"}}}}}}}},
]

_KIND_BY_TOOL = {
    "propose_scene_edits": "scene_edits",
    "propose_text_corrections": "text_corrections",
}


def _build_messages(scene_index, mentioned_scenes, raw_text, messages) -> list[dict]:
    lines = ["Scenes in this chapter (id · location · characters):"]
    for s in scene_index:
        chars = ", ".join(s.get("characters", []))
        lines.append(f"- {s['scene_id']} · {s.get('location', '')} · {chars}")
    ctx = "\n".join(lines)
    if mentioned_scenes:
        ctx += "\n\nFull detail for mentioned scene(s):\n" + json.dumps(mentioned_scenes, ensure_ascii=False)
    if raw_text:
        ctx += f"\n\nRaw chapter text:\n---\n{raw_text}\n---"
    return (
        [{"role": "system", "content": _SYSTEM}, {"role": "system", "content": ctx}]
        + [{"role": m["role"], "content": m["content"]} for m in messages]
    )


async def stream_chat(
    chunk_id: str,
    scene_index: list[dict],
    mentioned_scenes: list[dict],
    raw_text: str | None,
    messages: list[dict],
    thinking: bool,
    *,
    qwen_endpoint: str | None = None,
    model: str | None = None,
) -> AsyncIterator[dict]:
    """Yield ordered chat events: thinking | reply | tool | usage | done | error."""
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))
    context_limit = int(os.environ.get("QWEN_CONTEXT_LENGTH", "32768"))
    use_tools = os.environ.get("QWEN_TOOLS", "1") == "1"

    payload = {
        "model": model_name,
        "messages": _build_messages(scene_index, mentioned_scenes, raw_text, messages),
        "stream": True,
        "temperature": 0.3,
        "stream_options": {"include_usage": True},
        "chat_template_kwargs": {"enable_thinking": thinking},
    }
    if use_tools:
        payload["tools"] = _TOOLS

    logger.info("[chat] chunk=%s endpoint=%s model=%s thinking=%s tools=%s msgs=%d",
                chunk_id, endpoint, model_name, thinking, use_tools, len(messages))

    tool_frags: dict[int, dict] = {}
    content_buf = ""  # used by the fallback parser (Task 2)
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            async with client.stream("POST", f"{endpoint}/v1/chat/completions", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("usage"):
                        u = chunk["usage"]
                        yield {"event": "usage", "data": {
                            "prompt_tokens": u.get("prompt_tokens", 0),
                            "completion_tokens": u.get("completion_tokens", 0),
                            "total_tokens": u.get("total_tokens", 0),
                            "context_limit": context_limit,
                            "skipped_mentions": [],
                        }}
                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta") or {}
                        if delta.get("reasoning_content"):
                            yield {"event": "thinking", "data": {"delta": delta["reasoning_content"]}}
                        if delta.get("content"):
                            content_buf += delta["content"]
                            yield {"event": "reply", "data": {"delta": delta["content"]}}
                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            frag = tool_frags.setdefault(idx, {"name": "", "args": ""})
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                frag["name"] = fn["name"]
                            if fn.get("arguments"):
                                frag["args"] += fn["arguments"]
        for idx in sorted(tool_frags):
            frag = tool_frags[idx]
            kind = _KIND_BY_TOOL.get(frag["name"])
            if not kind:
                continue
            try:
                args = json.loads(frag["args"])
            except json.JSONDecodeError:
                logger.warning("[chat] dropping unparsable tool call %s", frag["name"])
                continue
            yield {"event": "tool", "data": {"kind": kind, "payload": args}}
        yield {"event": "done", "data": {}}
    except httpx.HTTPError as exc:
        logger.warning("[chat] stream error -> %s", repr(exc))
        yield {"event": "error", "data": {"detail": f"could not reach Qwen at {endpoint}: {exc}"}}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_engine.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/chat_engine.py tests/test_chat_engine.py
git commit -m "feat(chat): streaming tool-calling chat engine"
```
(End the commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.)

---

## Task 2: `chat_engine` — trailing-JSON fallback (`QWEN_TOOLS=0`)

**Files:**
- Modify: `animatory/chat_engine.py`
- Test: `tests/test_chat_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_engine.py  (append)
@pytest.mark.asyncio
async def test_stream_chat_fallback_parses_trailing_json(monkeypatch):
    monkeypatch.setenv("QWEN_TOOLS", "0")
    # The model streams prose then a fenced JSON block with edits.
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
    assert "```json" not in reply_text  # the JSON block is stripped from visible reply
    tools = [e for e in events if e["event"] == "tool"]
    assert len(tools) == 1
    assert tools[0]["data"]["kind"] == "scene_edits"
    assert tools[0]["data"]["payload"]["scene_id"] == "C001_S01"
    assert events[-1]["event"] == "done"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_engine.py::test_stream_chat_fallback_parses_trailing_json -v`
Expected: FAIL — the `data:` deltas are streamed verbatim (JSON block leaks into reply; no `tool` event).

- [ ] **Step 3: Write minimal implementation**

In `animatory/chat_engine.py`, add a fallback system note and a buffering reply path. Replace the reply-delta handling and the post-stream tool emission so that, when `use_tools` is False, content is buffered, the visible reply excludes a trailing ` ```json ``` ` block, and that block is parsed into tool events.

First, add an import and a fence regex near the top (after `logger = ...`):

```python
import re

_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```\s*$", re.DOTALL)
_FALLBACK_NOTE = (
    "\n\nIMPORTANT: tools are unavailable. To request changes, end your reply with a "
    "single fenced code block: ```json {\"scene_edits\": [{\"scene_id\": \"...\", "
    "\"changes\": {...}}], \"text_corrections\": [{\"find\": \"...\", \"replace\": "
    "\"...\"}]} ``` — omit the block entirely if no change is requested."
)
```

In `_build_messages`, accept a `use_tools` arg to append the note when tools are off:

```python
def _build_messages(scene_index, mentioned_scenes, raw_text, messages, use_tools) -> list[dict]:
    system = _SYSTEM if use_tools else _SYSTEM + _FALLBACK_NOTE
    lines = ["Scenes in this chapter (id · location · characters):"]
    for s in scene_index:
        chars = ", ".join(s.get("characters", []))
        lines.append(f"- {s['scene_id']} · {s.get('location', '')} · {chars}")
    ctx = "\n".join(lines)
    if mentioned_scenes:
        ctx += "\n\nFull detail for mentioned scene(s):\n" + json.dumps(mentioned_scenes, ensure_ascii=False)
    if raw_text:
        ctx += f"\n\nRaw chapter text:\n---\n{raw_text}\n---"
    return (
        [{"role": "system", "content": system}, {"role": "system", "content": ctx}]
        + [{"role": m["role"], "content": m["content"]} for m in messages]
    )
```

Update the call in `stream_chat`:
```python
        "messages": _build_messages(scene_index, mentioned_scenes, raw_text, messages, use_tools),
```

In tools mode the reply is streamed live (Task 1 behavior). In fallback mode, **buffer** the reply and flush it (minus any trailing JSON fence) after the stream, then parse the fence into tool events. Replace the `if delta.get("content"):` branch with:

```python
                        if delta.get("content"):
                            content_buf += delta["content"]
                            if use_tools:
                                yield {"event": "reply", "data": {"delta": delta["content"]}}
```

And replace the post-stream tool-emission block with:

```python
        if use_tools:
            for idx in sorted(tool_frags):
                frag = tool_frags[idx]
                kind = _KIND_BY_TOOL.get(frag["name"])
                if not kind:
                    continue
                try:
                    args = json.loads(frag["args"])
                except json.JSONDecodeError:
                    logger.warning("[chat] dropping unparsable tool call %s", frag["name"])
                    continue
                yield {"event": "tool", "data": {"kind": kind, "payload": args}}
        else:
            visible, edits = _split_fallback(content_buf)
            if visible:
                yield {"event": "reply", "data": {"delta": visible}}
            for kind, payload in edits:
                yield {"event": "tool", "data": {"kind": kind, "payload": payload}}
        yield {"event": "done", "data": {}}
```

Add the fallback splitter near the bottom of the module:

```python
def _split_fallback(content: str) -> tuple[str, list[tuple[str, dict]]]:
    """Split a fallback reply into (visible_prose, [(kind, payload), ...])."""
    m = _FENCE_RE.search(content)
    if not m:
        return content, []
    visible = content[: m.start()].rstrip()
    edits: list[tuple[str, dict]] = []
    try:
        block = json.loads(m.group(1))
    except json.JSONDecodeError:
        return content, []  # leave it visible rather than lose it
    for se in block.get("scene_edits", []):
        edits.append(("scene_edits", se))
    tc = block.get("text_corrections", [])
    if tc:
        edits.append(("text_corrections", {"corrections": tc}))
    return visible, edits
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_chat_engine.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/chat_engine.py tests/test_chat_engine.py
git commit -m "feat(chat): trailing-JSON fallback when tools unavailable"
```

---

## Task 3: `POST …/chat/stream` route + remove `/refine`

**Files:**
- Modify: `animatory/pipeline_router.py`
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_api.py  (append; AsyncMock/patch already imported from Task 6 of the prior plan)
@pytest.mark.asyncio
async def test_chat_stream_relays_engine_events(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "ch1")

    async def fake_stream(*args, **kwargs):
        yield {"event": "reply", "data": {"delta": "hi"}}
        yield {"event": "done", "data": {}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream):
        r = await client.post(
            f"/pipeline/episodes/ch1/chunks/{cid}/chat/stream",
            json={"messages": [{"role": "user", "content": "hi"}], "thinking": False,
                  "mentions": {"scenes": [], "raw": False}},
        )
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    body = r.text
    assert "event: reply" in body
    assert '"delta": "hi"' in body or '"delta":"hi"' in body
    assert "event: done" in body


@pytest.mark.asyncio
async def test_chat_stream_unknown_chunk_404(client: AsyncClient, tmp_path, monkeypatch):
    await _chunk_one(client, tmp_path, monkeypatch, "ch2")
    r = await client.post(
        "/pipeline/episodes/ch2/chunks/C999/chat/stream",
        json={"messages": [], "thinking": False, "mentions": {"scenes": [], "raw": False}},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_chat_stream_drops_foreign_scene_mentions(client: AsyncClient, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "ch3")
    await _parse_one(client, tmp_path, cid, "ch3")  # writes one scene {cid}_S01
    captured = {}

    async def fake_stream(*args, **kwargs):
        captured["mentioned"] = kwargs.get("mentioned_scenes", [])
        yield {"event": "done", "data": {}}

    with patch("animatory.pipeline_router.stream_chat", side_effect=fake_stream):
        await client.post(
            f"/pipeline/episodes/ch3/chunks/{cid}/chat/stream",
            json={"messages": [{"role": "user", "content": "x"}], "thinking": False,
                  "mentions": {"scenes": [f"{cid}_S01", "OTHER_S09"], "raw": False}},
        )
    ids = [s["scene_id"] for s in captured["mentioned"]]
    assert ids == [f"{cid}_S01"]  # foreign id dropped
```

Also DELETE the four old `/refine` tests (`test_refine_text_target`, `test_refine_scenes_target`, `test_refine_scenes_target_unparsed_404`, `test_refine_llm_failure_502`).

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py -k chat_stream -v`
Expected: FAIL — `405 Method Not Allowed`

- [ ] **Step 3: Write minimal implementation**

In `animatory/pipeline_router.py`:

(a) Replace the import line `from animatory.scene_refiner import proofread_text, refine_scenes` with:
```python
from animatory.chat_engine import stream_chat
from sse_starlette.sse import EventSourceResponse
```

(b) Delete `ChatMessageModel`, `RefineRequest`, and the entire `refine_chunk` route function.

(c) Add request models near `SaveScenesRequest`:
```python
class ChatTurnMessage(BaseModel):
    role: str
    content: str


class ChatMentions(BaseModel):
    scenes: list[str] = []
    raw: bool = False


class ChatStreamRequest(BaseModel):
    messages: list[ChatTurnMessage]
    thinking: bool = False
    mentions: ChatMentions = ChatMentions()
```

(d) Add the route (after the scenes routes):
```python
@router.post("/episodes/{episode_id}/chunks/{chunk_id}/chat/stream")
async def chat_stream(episode_id: str, chunk_id: str, body: ChatStreamRequest):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)

    # Build context from the parsed scenes (edited copy preferred), scoped to this chunk.
    doc = _scenes_payload(ep_dir, chunk_id)
    all_scenes = doc.get("scenes", []) if doc else []
    valid_ids = {s["scene_id"] for s in all_scenes}
    scene_index = [
        {"scene_id": s["scene_id"], "location": s.get("location", ""),
         "characters": s.get("characters", [])}
        for s in all_scenes
    ]
    mentioned = [s for s in all_scenes if s["scene_id"] in set(body.mentions.scenes) & valid_ids]
    raw_text = _text_payload(ep_dir, chunk_id, meta)["text"] if body.mentions.raw else None
    messages = [m.model_dump() for m in body.messages]

    async def gen():
        async for ev in stream_chat(
            chunk_id=chunk_id,
            scene_index=scene_index,
            mentioned_scenes=mentioned,
            raw_text=raw_text,
            messages=messages,
            thinking=body.thinking,
        ):
            yield {"event": ev["event"], "data": json.dumps(ev["data"], ensure_ascii=False)}

    return EventSourceResponse(gen())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/test_pipeline_api.py -v`
Expected: PASS (chat_stream tests added; `/refine` tests gone; rest green)

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(pipeline): /chat/stream SSE route; remove /refine"
```

---

## Task 4: Delete `scene_refiner.py`

**Files:**
- Delete: `animatory/scene_refiner.py`, `tests/test_scene_refiner.py`

- [ ] **Step 1: Confirm nothing imports it**

Run: `git grep -n "scene_refiner" -- "*.py"`
Expected: no matches (Task 3 removed the import). If any remain, fix them before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm animatory/scene_refiner.py tests/test_scene_refiner.py
```

- [ ] **Step 3: Run the whole backend suite**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/ -q`
Expected: PASS, no import errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(chat): remove superseded scene_refiner module"
```

---

## Task 5: Frontend SSE client `chat.ts`

**Files:**
- Create: `frontend/src/api/chat.ts`
- Test: `frontend/src/api/chat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/api/chat.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseSSE, streamChat } from './chat'

describe('parseSSE', () => {
  it('splits complete records and keeps the remainder', () => {
    const buf = 'event: reply\ndata: {"delta":"hi"}\n\nevent: done\ndata: {}\n\nevent: par'
    const { records, rest } = parseSSE(buf)
    expect(records).toEqual([
      { event: 'reply', data: '{"delta":"hi"}' },
      { event: 'done', data: '{}' },
    ])
    expect(rest).toBe('event: par')
  })
})

function streamResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('streamChat', () => {
  it('dispatches reply/tool/done handlers in order', async () => {
    const sse =
      'event: reply\ndata: {"delta":"Hi"}\n\n' +
      'event: tool\ndata: {"kind":"scene_edits","payload":{"scene_id":"C001_S01","changes":{"mood":"dark"}}}\n\n' +
      'event: done\ndata: {}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(sse)))

    const got: string[] = []
    await new Promise<void>(resolve => {
      streamChat('ep1', 'C001',
        { messages: [{ role: 'user', content: 'hi' }], thinking: false, mentions: { scenes: [], raw: false } },
        {
          onReply: d => got.push('reply:' + d),
          onTool: (k) => got.push('tool:' + k),
          onUsage: () => {},
          onDone: () => { got.push('done'); resolve() },
          onError: () => { got.push('error'); resolve() },
        })
    })
    expect(got).toEqual(['reply:Hi', 'tool:scene_edits', 'done'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/chat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/api/chat.ts
import { API_BASE_URL } from '../config'
import type { ChatMessage } from './pipeline'

export interface ChatMention { scenes: string[]; raw: boolean }
export interface ChatUsage {
  prompt_tokens: number
  total_tokens: number
  context_limit: number
  skipped_mentions: string[]
}
export interface ChatStreamHandlers {
  onThinking?(delta: string): void
  onReply(delta: string): void
  onTool(kind: 'scene_edits' | 'text_corrections', payload: unknown): void
  onUsage(u: ChatUsage): void
  onDone(): void
  onError(detail: string): void
}
export interface SSERecord { event: string; data: string }

/** Pure: split a buffer into complete SSE records, returning the unparsed remainder. */
export function parseSSE(buffer: string): { records: SSERecord[]; rest: string } {
  const records: SSERecord[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length) records.push({ event, data: dataLines.join('\n') })
  }
  return { records, rest }
}

function dispatch(r: SSERecord, h: ChatStreamHandlers): void {
  let d: Record<string, unknown> = {}
  try { d = JSON.parse(r.data) } catch { return }
  switch (r.event) {
    case 'thinking': h.onThinking?.(String(d.delta ?? '')); break
    case 'reply': h.onReply(String(d.delta ?? '')); break
    case 'tool': h.onTool(d.kind as 'scene_edits' | 'text_corrections', d.payload); break
    case 'usage': h.onUsage(d as unknown as ChatUsage); break
    case 'error': h.onError(String(d.detail ?? 'chat error')); break
    default: break
  }
}

export function streamChat(
  episodeId: string,
  chunkId: string,
  body: { messages: ChatMessage[]; thinking: boolean; mentions: ChatMention },
  handlers: ChatStreamHandlers,
): { abort(): void } {
  const ctrl = new AbortController()
  void (async () => {
    try {
      const url = `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/chat/stream`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) { handlers.onError(`chat failed ${res.status}`); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const { records, rest } = parseSSE(buf)
        buf = rest
        for (const r of records) dispatch(r, handlers)
      }
      handlers.onDone()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') handlers.onError(String(e))
    }
  })()
  return { abort: () => ctrl.abort() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/chat.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/chat.ts frontend/src/api/chat.test.ts
git commit -m "feat(frontend): SSE chat stream client + parser"
```

---

## Task 6: Mention parser `mentions.ts`

**Files:**
- Create: `frontend/src/components/refine/mentions.ts`
- Test: `frontend/src/components/refine/mentions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/components/refine/mentions.test.ts
import { describe, it, expect } from 'vitest'
import { parseMentions } from './mentions'

const IDS = ['C001_S01', 'C001_S02', 'C001_S03']

describe('parseMentions', () => {
  it('resolves @SceneN to the current chunk scene id', () => {
    expect(parseMentions('look at @Scene2 please', IDS)).toEqual({ scenes: ['C001_S02'], raw: false })
  })
  it('detects @raw', () => {
    expect(parseMentions('check @raw text', IDS)).toEqual({ scenes: [], raw: true })
  })
  it('ignores unknown scene numbers and dedupes', () => {
    expect(parseMentions('@Scene9 @Scene1 @Scene1', IDS)).toEqual({ scenes: ['C001_S01'], raw: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/refine/mentions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/components/refine/mentions.ts
import type { ChatMention } from '../../api/chat'

/**
 * Extract @Scene<N> and @raw mentions from a draft. @Scene<N> resolves to the
 * current chunk's scene id ending in _S0<N> — so it can never point at another
 * chapter's scene. Unknown numbers are ignored; results are de-duplicated.
 */
export function parseMentions(draft: string, sceneIds: string[]): ChatMention {
  const raw = /(^|\s)@raw\b/i.test(draft)
  const scenes: string[] = []
  const re = /(^|\s)@Scene(\d{1,3})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(draft)) !== null) {
    const n = m[2].padStart(2, '0')
    const id = sceneIds.find(s => s.endsWith(`_S${n}`))
    if (id && !scenes.includes(id)) scenes.push(id)
  }
  return { scenes, raw }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/refine/mentions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/refine/mentions.ts frontend/src/components/refine/mentions.test.ts
git commit -m "feat(frontend): @Scene/@raw mention parser scoped to current chunk"
```

---

## Task 7: Rewrite `RefineChat` for streaming

**Files:**
- Rewrite: `frontend/src/components/refine/RefineChat.tsx`

> Run the `ui-taste` skill before writing JSX. Keep one accent (`#3772cf`/`#2c5cab`), tokens, focus-visible rings, restrained motion, real states.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/refine/RefineChat.tsx
import { useMemo, useState } from 'react'
import type { ChatMessage } from '../../api/pipeline'
import type { ChatMention, ChatUsage } from '../../api/chat'
import { parseMentions } from './mentions'

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  streamReply: string
  streamThinking: string
  thinkingEnabled: boolean
  usage: ChatUsage | null
  error: string
  sceneIds: string[]
  onToggleThinking: () => void
  onSend: (text: string, mentions: ChatMention) => void
  onAbort: () => void
  onRetry: () => void
  onNewChat: () => void
}

export function RefineChat(props: Props) {
  const {
    messages, streaming, streamReply, streamThinking, thinkingEnabled, usage, error,
    sceneIds, onToggleThinking, onSend, onAbort, onRetry, onNewChat,
  } = props
  const [draft, setDraft] = useState('')
  const [showThoughts, setShowThoughts] = useState(true)

  // @-mention autocomplete on the trailing @token.
  const trailing = /(^|\s)@(\w*)$/.exec(draft)
  const suggestions = useMemo(() => {
    if (!trailing) return [] as string[]
    const q = trailing[2].toLowerCase()
    const opts = ['raw', ...sceneIds.map((_, i) => `Scene${String(i + 1).padStart(2, '0')}`)]
    return opts.filter(o => o.toLowerCase().startsWith(q)).slice(0, 6)
  }, [trailing, sceneIds])

  function applySuggestion(s: string) {
    setDraft(d => d.replace(/@(\w*)$/, `@${s} `))
  }
  function submit() {
    const text = draft.trim()
    if (!text || streaming) return
    onSend(text, parseMentions(text, sceneIds))
    setDraft('')
  }

  const pct = usage && usage.context_limit > 0
    ? Math.min(100, Math.round((usage.prompt_tokens / usage.context_limit) * 100)) : 0

  return (
    <div className="flex flex-col h-full rounded-lg border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
        <h2 className="text-sm font-semibold text-ink">Refine</h2>
        <div className="flex items-center gap-3">
          {usage && <ContextRing pct={pct} label={`${usage.prompt_tokens} / ${usage.context_limit}`} />}
          <button
            type="button"
            onClick={onToggleThinking}
            disabled={streaming}
            className={
              'text-[11px] rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ' +
              (thinkingEnabled ? 'border-[#3772cf] text-[#3772cf]' : 'border-hairline text-steel hover:text-ink')
            }
          >
            Thinking {thinkingEnabled ? 'on' : 'off'}
          </button>
          <button type="button" onClick={onNewChat} disabled={streaming}
            className="text-[11px] text-steel hover:text-ink disabled:opacity-40 transition-colors">
            New chat
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !streaming ? (
          <p className="text-xs text-stone leading-relaxed">
            Ask about this chapter, or request a change. Tag context with <code className="text-steel">@Scene1</code> or <code className="text-steel">@raw</code>.
          </p>
        ) : (
          messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)
        )}

        {streaming && (
          <div className="space-y-2">
            {thinkingEnabled && streamThinking && (
              <div className="rounded-md border border-hairline bg-surface">
                <button onClick={() => setShowThoughts(s => !s)}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-steel hover:text-ink transition-colors">
                  {showThoughts ? '▾' : '▸'} Thinking…
                </button>
                {showThoughts && (
                  <pre className="px-3 pb-2 text-[11px] text-stone whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{streamThinking}</pre>
                )}
              </div>
            )}
            <Bubble role="assistant" content={streamReply || '…'} />
          </div>
        )}

        {error && (
          <div className="text-xs text-brand-error">
            {error}{' '}
            <button onClick={onRetry} className="underline hover:text-ink">Retry</button>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        {suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => applySuggestion(s)}
                className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-steel hover:text-ink hover:border-[#3772cf] transition-colors">
                @{s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={2}
            placeholder="Ask or request a change… (@Scene1, @raw)"
            className="flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink placeholder:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          />
          {streaming ? (
            <button type="button" onClick={onAbort}
              className="px-3 py-2 rounded-md border border-hairline text-steel text-xs hover:bg-surface transition-colors">
              Stop
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!draft.trim()}
              className="px-3 py-2 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, content }: { role: ChatMessage['role']; content: string }) {
  return (
    <div className={role === 'user' ? 'text-right' : 'text-left'}>
      <span className={
        'inline-block rounded-md px-3 py-2 text-xs leading-snug max-w-[85%] text-left whitespace-pre-wrap ' +
        (role === 'user' ? 'bg-[#3772cf] text-white' : 'bg-surface text-ink border border-hairline')
      }>
        {content}
      </span>
    </div>
  )
}

function ContextRing({ pct, label }: { pct: number; label: string }) {
  const r = 7, c = 2 * Math.PI * r
  const danger = pct >= 90
  return (
    <span title={`Context: ${label}`} className="inline-flex items-center" aria-label={`Context ${pct}%`}>
      <svg viewBox="0 0 18 18" className="w-4 h-4 -rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-hairline" />
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          stroke={danger ? '#d45656' : '#3772cf'}
          strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
    </span>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: errors only in `ChapterView.tsx` (old props) — those are fixed in Task 8. If `RefineChat.tsx` itself has errors, fix them.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/RefineChat.tsx
git commit -m "feat(frontend): streaming RefineChat with thinking, mentions, context ring"
```

---

## Task 8: Wire `ChapterView` to streaming chat

**Files:**
- Modify: `frontend/src/studio/views/ChapterView.tsx`
- Modify: `frontend/src/api/pipeline.ts` (remove `refineChat` + `RefineResult`)

- [ ] **Step 1: Remove the dead refine client**

In `frontend/src/api/pipeline.ts`, delete the `RefineResult` interface and the `refineChat` function. Keep `ChatMessage`, `ScenePatch`, `TextCorrection`, `saveText`, `resetText`, `saveScenes`, `resetScenes`.

- [ ] **Step 2: Rewrite the chat wiring in `ChapterView.tsx`**

Replace the imports block's pipeline import to drop `refineChat` and add the chat client:
```tsx
import {
  getChunkScenes, getChunkText, parseEpisode,
  saveScenes, saveText, resetScenes, resetText,
  type ChatMessage, type PipelineScene, type ScenePatch, type TextCorrection,
} from '../../api/pipeline'
import { streamChat, type ChatMention, type ChatUsage } from '../../api/chat'
```

Replace the entire "Chat state" block and the "--- Chat ---" handlers with the streaming version. Chat state:
```tsx
  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamReply, setStreamReply] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [usage, setUsage] = useState<ChatUsage | null>(null)
  const [chatError, setChatError] = useState('')
  const chatAbortRef = useRef<{ abort(): void } | null>(null)
  const lastTurnRef = useRef<{ text: string; mentions: ChatMention } | null>(null)
```
(Keep the existing `proposals`, `skipped`, scene/text state. `target` state and its auto-follow effect are REMOVED — delete the `target` useState and the `useEffect(() => { setTarget(...) }, [parsed])`.)

Add `useRef` to the React import if not already present.

Chat handlers (replace the old `sendMessages`/`onSend`/`onRetry`):
```tsx
  // --- Chat (streaming) ---
  function runTurn(history: ChatMessage[], text: string, mentions: ChatMention) {
    lastTurnRef.current = { text, mentions }
    const next = [...history, { role: 'user' as const, content: text }]
    setMessages(next)
    setStreaming(true); setChatError(''); setStreamReply(''); setStreamThinking(''); setSkipped(0)
    let reply = ''
    const handle = streamChat(
      episodeId, chunkId,
      { messages: next, thinking: thinkingEnabled, mentions },
      {
        onThinking: d => setStreamThinking(t => t + d),
        onReply: d => { reply += d; setStreamReply(reply) },
        onTool: (kind, payload) => {
          if (kind === 'scene_edits') {
            const p = payload as ScenePatch
            if (scenes.some(s => s.scene_id === p.scene_id)) {
              setProposals(prev => ({ ...prev, [p.scene_id]: p }))
            } else {
              setSkipped(n => n + 1)
            }
          } else {
            const { corrections: cs } = payload as { corrections: TextCorrection[] }
            setCorrections(cs ?? [])
          }
        },
        onUsage: u => setUsage(u),
        onDone: () => {
          setStreaming(false)
          setMessages(m => reply ? [...m, { role: 'assistant', content: reply }] : m)
          setStreamReply(''); setStreamThinking('')
        },
        onError: detail => { setStreaming(false); setChatError(detail) },
      },
    )
    chatAbortRef.current = handle
  }
  function onSend(text: string, mentions: ChatMention) {
    if (!streaming) runTurn(messages, text, mentions)
  }
  function onAbortChat() {
    chatAbortRef.current?.abort()
    setStreaming(false)
    setMessages(m => streamReply ? [...m, { role: 'assistant', content: streamReply }] : m)
    setStreamReply(''); setStreamThinking('')
  }
  function onRetryChat() {
    const last = lastTurnRef.current
    if (last) runTurn(messages.slice(0, -1).filter((_, i, a) => i < a.length), last.text, last.mentions)
  }
  function onNewChat() {
    chatAbortRef.current?.abort()
    setMessages([]); setStreaming(false); setStreamReply(''); setStreamThinking('')
    setChatError(''); setUsage(null)
  }
```

Note on `onRetryChat`: the failed turn already appended the user message; drop the last (user) message before re-running so `runTurn` re-adds it once. Simpler exact form:
```tsx
  function onRetryChat() {
    const last = lastTurnRef.current
    if (!last) return
    const history = messages[messages.length - 1]?.role === 'user' ? messages.slice(0, -1) : messages
    runTurn(history, last.text, last.mentions)
  }
```
Use this second form (delete the first).

Add an unmount cleanup effect near the existing parse cleanup:
```tsx
  useEffect(() => () => { chatAbortRef.current?.abort() }, [])
```

- [ ] **Step 3: Update the `RefineChat` usage in the JSX**

Compute scene ids and replace the `<RefineChat .../>` element:
```tsx
        <div className="lg:sticky lg:top-6 h-[70vh]">
          <RefineChat
            messages={messages}
            streaming={streaming}
            streamReply={streamReply}
            streamThinking={streamThinking}
            thinkingEnabled={thinkingEnabled}
            usage={usage}
            error={chatError}
            sceneIds={scenes.map(s => s.scene_id)}
            onToggleThinking={() => setThinkingEnabled(v => !v)}
            onSend={onSend}
            onAbort={onAbortChat}
            onRetry={onRetryChat}
            onNewChat={onNewChat}
          />
        </div>
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc -b --noEmit` (no errors), `npx vitest run` (all green), `npm run build` (succeeds).
Expected: all pass. Fix any leftover references to the removed `target`/`refineChat`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/studio/views/ChapterView.tsx frontend/src/api/pipeline.ts
git commit -m "feat(frontend): drive ChapterView chat via streaming engine"
```

---

## Task 9: ui-taste pass + verification

**Files:** none (review + verification)

- [ ] **Step 1: Run the `ui-taste` skill** against `RefineChat.tsx` and the updated `ChapterView.tsx`. Fix any smell-test failures (accent discipline, tokens, focus-visible, restrained motion, real states). The context ring uses raw accent/`#d45656` hex — confirm that matches the existing `brand-error` token value (`#d45656`) and the single-accent rule.

- [ ] **Step 2: Final test + build**

Run: `ANIMATORY_FAKE_EXECUTORS=1 python -m pytest tests/ -q`
Run: `cd frontend && npx vitest run && npm run build`
Expected: backend green, frontend green, build succeeds.

- [ ] **Step 3: Live smoke (requires the stack).** With the backend running and Qwen at `:1090` (tools-capable; else set `QWEN_TOOLS=0`), open a parsed chapter and confirm via the preview tools:
  - "hi" → a normal streamed reply, no 502.
  - Thinking toggle ON → live thinking block streams.
  - "make @Scene1 darker" → reply + a Suggested banner on Scene 1; Accept → working copy; Save persists.
  - "fix @raw: change X to Y" → a text correction appears; Accept applies.
  - Context ring updates; Stop aborts mid-stream; New chat clears.
  Capture a screenshot as evidence.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(chat): ui-taste fixes + A1 verification"
```

---

## Notes for the implementer
- **LLM always mocked in tests.** Patch `animatory.chat_engine.httpx.AsyncClient` (engine tests) or `animatory.pipeline_router.stream_chat` (route tests). Never hit a live Qwen.
- **No mock path for pipeline routes in the frontend** — the chat needs the live stack; correctness of pure pieces is covered by `parseSSE`, `streamChat`, and `parseMentions` unit tests.
- **Tool payload shapes** map directly to existing UI types: `scene_edits` payload === `ScenePatch`; `text_corrections` payload === `{ corrections: TextCorrection[] }`. Accept/reject reuses the v1 banners.
- **Streaming reply buffering:** in tools mode the reply streams live; in `QWEN_TOOLS=0` fallback it is flushed once at the end (minus the JSON block). This difference is intentional.
