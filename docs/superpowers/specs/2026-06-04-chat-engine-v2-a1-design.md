# Chat Engine v2 — A1: Streaming Conversational Chat with Tool-Calling Edits

**Date:** 2026-06-04
**Status:** Approved
**Sub-project:** A1 of Chat Engine v2 (A2 = persisted/named history, separate spec)

---

## Overview

Replace the brittle "force every turn through `json.loads`" refine chat with a
real **streaming, tool-calling** chat over a chapter. The model converses
normally and emits **structured edit proposals only via tool calls**, so a plain
message like "hi" gets a normal reply (the current 502 cause is gone for good).
Thinking can be toggled and streams live. Context is built from **@-mentions**,
not the whole text, to respect the model's ~32k session window, which is shown as
a usage meter.

This supersedes the synchronous `/refine` flow from
[`2026-06-04-scene-refinement-design.md`](2026-06-04-scene-refinement-design.md):
A1 removes `/refine`, `refineChat`, and the `proofread_text`/`refine_scenes`
one-shot functions, replacing them with a streaming chat endpoint and engine.
(The interim 502 hot-fix in `scene_refiner.py` is also removed with them.)

---

## Scope

**In scope:**
- `animatory/chat_engine.py` — streaming Qwen chat with tool-calling
- `POST …/chunks/{cid}/chat/stream` — SSE endpoint (prose + thinking + tool calls + usage)
- Two tools: `propose_scene_edits`, `propose_text_corrections`
- @-mention context building (`@SceneN` current-chunk-scoped, `@raw`) + compact scene index
- Thinking toggle → live thinking stream
- Context-capacity meter (used / 32k) from streamed usage
- In-memory session (transcript held in the page) + "New chat" reset
- Frontend: streaming `RefineChat` with mention autocomplete; tool edits land as
  accept/reject proposals (reusing the existing card banners / text corrections)
- Removal of the now-dead `/refine` route, `refineChat`, and
  `proofread_text`/`refine_scenes`

**Out of scope (later):**
- Persisted, named chat history + `/clear`-as-new-session (A2)
- Per-dialogue tone/emotion + character voice profiles (sub-project B)
- Per-scene re-parse (sub-project C)
- @-mention ranges (`@Scene1-3`), cross-chunk mentions

---

## Architecture

```
RefineChat (stream reader)
   │  POST …/chat/stream  { messages, thinking, mentions:{scenes[],raw} }
   ▼
pipeline_router.chat_stream  ──►  chat_engine.stream_chat()  ──►  Qwen (stream:true, tools)
   │  text/event-stream                                            │ SSE deltas
   ▼                                                               ▼
events: thinking | reply | tool | usage | done | error  ◄── accumulate tool-call fragments
```

The chat is **stateless on the server** in A1: the client sends the full
transcript each turn. (A2 adds the SQLite session store.)

---

## Backend

### Transport: SSE over POST

EventSource is GET-only and cannot send a body, and a chat turn carries the
transcript + mentions + thinking flag. So the endpoint is a **POST returning
`text/event-stream`** (via `sse_starlette.EventSourceResponse`, already a
dependency), and the **frontend reads it with `fetch` + a ReadableStream SSE
parser** (small client util) rather than `EventSource`.

### `POST /pipeline/episodes/{episode_id}/chunks/{chunk_id}/chat/stream`

Request body:
```jsonc
{
  "messages": [{ "role": "user" | "assistant", "content": "..." }],
  "thinking": false,
  "mentions": { "scenes": ["C001_S01"], "raw": false }
}
```
- `mentions.scenes` are **resolved client-side to current-chunk scene_ids** (see
  Frontend). The server validates each id belongs to this chunk; unknown ids are
  ignored (and reported in the first `usage`/`done` event as `skipped_mentions`).
- 404 if episode/chunk unknown. 422 on malformed body.

Response: `text/event-stream`. Event types (each `data:` is JSON):

| event | data | when |
|-------|------|------|
| `thinking` | `{ "delta": "…" }` | only if `thinking:true`; reasoning tokens |
| `reply` | `{ "delta": "…" }` | prose reply tokens |
| `tool` | `{ "kind": "scene_edits" \| "text_corrections", "payload": {…} }` | a completed tool call |
| `usage` | `{ "prompt_tokens": N, "completion_tokens": N, "total_tokens": N, "context_limit": 32768, "skipped_mentions": [] }` | near end |
| `done` | `{ "reply": "…", "tool_calls": [ … ] }` | final consolidated turn |
| `error` | `{ "detail": "…" }` | LLM unreachable / stream broke |

### Module: `animatory/chat_engine.py`

```python
async def stream_chat(
    chunk_id: str,
    scene_index: list[dict],      # [{scene_id, location, characters}]
    mentioned_scenes: list[dict], # full scene dicts for @-mentioned ids
    raw_text: str | None,         # included only if @raw
    messages: list[dict],
    thinking: bool,
    *, qwen_endpoint=None, model=None,
) -> AsyncIterator[dict]:          # yields {"event": ..., "data": {...}}
    ...
```

- Calls `POST {endpoint}/v1/chat/completions` with `stream=True`,
  `stream_options={"include_usage": True}`, `tools=[…]`, and
  `chat_template_kwargs={"enable_thinking": thinking}` (httpx streaming —
  `client.stream("POST", …)`).
- Parses streamed deltas:
  - `delta.reasoning_content` → `thinking` events (Qwen emits this when thinking
    is enabled).
  - `delta.content` → `reply` events.
  - `delta.tool_calls[]` arrive as **fragments** (id/name once, arguments in
    pieces) — accumulate per index; when a tool call's JSON arguments parse
    cleanly, emit one `tool` event.
  - final chunk `usage` → `usage` event (add `context_limit` from
    `QWEN_CONTEXT_LENGTH`, default 32768).
- On HTTP/transport error: yield an `error` event and stop (no multi-retry mid-
  stream; the client offers Retry).

**Tool schemas** (OpenAI `tools` format) sent to the model:
```jsonc
[
  { "type": "function", "function": {
    "name": "propose_scene_edits",
    "description": "Propose edits to ONE existing scene. Only fields to change.",
    "parameters": { "type": "object", "required": ["scene_id", "changes"],
      "properties": {
        "scene_id": { "type": "string" },
        "changes": { "type": "object", "properties": {
          "location": {"type":"string"}, "characters": {"type":"array","items":{"type":"string"}},
          "shot_type": {"type":"string"}, "action": {"type":"string"}, "mood": {"type":"string"},
          "dialogue": {"type":"array","items":{"type":"object",
            "properties":{"character":{"type":"string"},"line":{"type":"string"}}}} } },
        "rationale": { "type": "string" } } } } },
  { "type": "function", "function": {
    "name": "propose_text_corrections",
    "description": "Propose find/replace fixes to the raw chapter text.",
    "parameters": { "type": "object", "required": ["corrections"],
      "properties": { "corrections": { "type": "array", "items": { "type": "object",
        "required": ["find","replace"], "properties": {
          "find": {"type":"string"}, "replace": {"type":"string"},
          "rationale": {"type":"string"}, "all_occurrences": {"type":"boolean"} } } } } } } }
]
```

**System prompt** (assembled in the engine): role framing (Vietnamese
novel-to-animation assistant); "Chat normally in prose. Call
`propose_scene_edits` / `propose_text_corrections` ONLY when the user asks for a
change — never to answer a question." Then a compact **scene index** block
(`scene_id · location · characters` per scene), the **full JSON** of any
@-mentioned scenes, and the **raw text** only if `@raw`. Then the conversation.

**Tool-calling fallback (risk):** if the local `llama-server` build rejects
`tools` or never emits `tool_calls` in streaming, the engine falls back to
instructing the model to end its reply with an optional fenced
` ```json {"scene_edits":[…],"text_corrections":[…]} ``` ` block, which the
engine strips from the streamed `reply`, parses, and emits as `tool` events. The
event contract to the client is unchanged. (Decided at engine level by a
`QWEN_TOOLS=1|0` env flag, default `1`.)

### Config (new env vars)
| Variable | Default | Purpose |
|---|---|---|
| `QWEN_CONTEXT_LENGTH` | `32768` | Context-limit shown in the meter |
| `QWEN_TOOLS` | `1` | `0` forces the trailing-JSON fallback |

(Reuses `QWEN_ENDPOINT`, `QWEN_MODEL`, `QWEN_TIMEOUT_S`, `QWEN_ENABLE_THINKING`.)

### Removals
- Route `POST …/refine` and its request models.
- `animatory/scene_refiner.py` (`proofread_text`, `refine_scenes`, helpers) and
  `tests/test_scene_refiner.py` — superseded by `chat_engine.py`.
- The `/refine` tests in `tests/test_pipeline_api.py`.

---

## Frontend

### Streaming client (`frontend/src/api/chat.ts`)

```ts
export interface ChatMention { scenes: string[]; raw: boolean }
export interface ChatStreamHandlers {
  onThinking?(delta: string): void
  onReply(delta: string): void
  onTool(kind: 'scene_edits' | 'text_corrections', payload: unknown): void
  onUsage(u: { prompt_tokens: number; total_tokens: number; context_limit: number; skipped_mentions: string[] }): void
  onDone(): void
  onError(detail: string): void
}
export function streamChat(
  episodeId: string, chunkId: string,
  body: { messages: ChatMessage[]; thinking: boolean; mentions: ChatMention },
  handlers: ChatStreamHandlers,
): { abort(): void }   // fetch + ReadableStream SSE reader; abortable
```
A small pure `parseSSE(chunk, buffer)` helper (its own unit-tested module) splits
the byte stream into `{event, data}` records.

### Mentions (`frontend/src/components/refine/mentions.ts`, pure + tested)
- `parseMentions(draft, sceneIds): { scenes: string[]; raw: boolean }` — extracts
  `@SceneN` tokens, maps `N` → `{chunkId}_S0N` **restricted to the current
  chunk's scene ids**, and `@raw` → `raw:true`. Unknown `@SceneN` ignored.

### `RefineChat` (extended)
- **Thinking toggle** in the header (persisted in component state) → sent as
  `thinking`.
- **@-mention autocomplete**: typing `@` opens a menu of the current chunk's
  scenes (`Scene 01 · location`) + `raw`; selecting inserts the token.
- **Streaming render**: the in-flight assistant turn shows a live **thinking**
  collapsible (when thinking on) above the streaming **reply**; an **Abort**
  control during streaming; inline error + **Retry** on `error`.
- **Context ring**: a small SVG ring showing `prompt_tokens / context_limit` from
  the latest `usage`, turning to the accent then `brand-error` as it nears the
  limit; tooltip shows exact counts and any `skipped_mentions`.
- **New chat**: clears the in-memory transcript (A1's reset; persisted sessions
  come in A2).
- Tool events route up: `scene_edits` → existing proposal banner on the matching
  card; `text_corrections` → existing RawTextEditor corrections. Accept/Reject
  unchanged.

### `ChapterView` wiring
- Replaces the `refineChat(...)` call with `streamChat(...)`, feeding handlers:
  `onReply`/`onThinking` build the live assistant message; `onTool` distributes to
  `proposals` / `corrections` (current handlers); `onUsage` updates the meter;
  `onError` sets chat error. Keeps the adaptive target indicator only as a hint
  (tools make target implicit), or drops it — **dropped in A1** since tools, not
  a mode switch, decide text-vs-scene edits.
- Passes the current chunk's scene ids to `RefineChat` for mention autocomplete +
  resolution.

---

## Error handling
- LLM unreachable / stream aborts → `error` event → inline message + Retry
  (re-sends the same transcript). Partial reply text is kept visible.
- Tool-call arguments that never parse → that fragment is dropped with a console
  warning and a `done.skipped_tool_calls` count surfaced as a small note.
- @-mention to a non-existent scene → ignored, surfaced via `usage.skipped_mentions`.
- Context ring at/over 100% → non-blocking warning ("trim mentions or start a new
  chat"); the request still sends.

---

## Testing

**Backend** (LLM mocked — never hit a live Qwen):
- `tests/test_chat_engine.py` — feed a fake streamed chunk sequence (reply
  deltas; reasoning deltas when thinking; fragmented `tool_calls`; trailing
  usage) into a mocked `httpx` stream; assert `stream_chat` yields the right
  ordered events, accumulates tool-call fragments into one `tool` event, and maps
  usage. Cover the `QWEN_TOOLS=0` trailing-JSON fallback path.
- `tests/test_pipeline_api.py` — `POST …/chat/stream` with a mocked
  `chat_engine.stream_chat` returns `text/event-stream` with the expected events;
  404 on unknown chunk; mention validation drops foreign scene ids. Remove the
  old `/refine` tests.

**Frontend** (Vitest):
- `chat.test.ts` — `parseSSE` splits multi-event byte chunks (incl. split across
  reads) into records; `streamChat` invokes handlers in order against a mocked
  `fetch` returning a ReadableStream.
- `mentions.test.ts` — `parseMentions` resolves `@Scene2`→`C001_S02`, `@raw`,
  ignores `@Scene9` when absent, scopes to current chunk.

---

## Definition of Done
- [ ] `chat_engine.stream_chat` yields ordered `thinking`/`reply`/`tool`/`usage`/
      `done` events from a mocked stream; tool-call fragments accumulate; tests pass
- [ ] `QWEN_TOOLS=0` fallback parses a trailing JSON block into `tool` events
- [ ] `POST …/chat/stream` streams SSE; 404/validation correct; old `/refine`
      removed; suite green
- [ ] `scene_refiner.py` + its tests removed; no dead references
- [ ] `parseSSE` + `streamChat` + `parseMentions` unit-tested and green
- [ ] `RefineChat`: streaming reply + live thinking (toggle), @-mention
      autocomplete, context ring, Abort/Retry, New chat
- [ ] Tool edits land as accept/reject on scene cards / raw-text corrections
- [ ] `ui-taste` smell test passes for the chat panel
- [ ] `tsc` clean, `npm run build` succeeds, `pytest tests/ -q` green
