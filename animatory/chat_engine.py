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
