# Chat Engine v2 — A2: Persisted, Named Chat History

**Date:** 2026-06-04
**Status:** Approved
**Sub-project:** A2 of Chat Engine v2 (A1 = streaming tool-calling chat, already shipped)

---

## Overview

A1 chat is stateless: the browser holds the transcript and the server persists
nothing. A2 makes the **server authoritative** — chat turns live in SQLite,
keyed by episode + chunk, organized into **named sessions**. You resume the
latest session when you reopen a chapter, browse past sessions, rename them,
delete them, and start fresh with **New chat** / `/clear`. Sessions are
auto-named by a cheap LLM titling call after the first exchange.

Builds directly on A1
([`2026-06-04-chat-engine-v2-a1-design.md`](2026-06-04-chat-engine-v2-a1-design.md)).
The streaming engine (`chat_engine.stream_chat`), tool calls, mentions, thinking,
and the context ring are unchanged; A2 changes *where the transcript lives* and
adds session management around the existing stream.

---

## Scope

**In scope:**
- `animatory/chat_store.py` — aiosqlite store (+ `InMemoryChatStore` for tests),
  wired into `app.state.chat_store`
- Stream route becomes server-authoritative: `{session_id?, message, …}`; loads
  history, persists user + assistant turns, emits `session` + `title` events
- `generate_title()` in `chat_engine.py` (cheap non-streaming LLM call + fallback)
- Session CRUD routes (list / create / get / rename / delete)
- Frontend: session switcher + history list, New chat, inline rename, delete,
  `/clear`; `ChapterView` resumes the latest session on open
- Tests for the store, the routes, and the frontend session client

**Out of scope (later / other sub-projects):**
- Splitting chat routes into a dedicated `chat_router.py` (noted; helpers stay
  shared in `pipeline_router.py`)
- Cross-chunk / global chat search
- Editing or deleting individual past messages (sessions are the unit)
- Streaming the title token-by-token (it is a short one-shot)
- Parse enrichment (B) and per-scene re-parse (C)

---

## Data model — `animatory/chat_store.py`

Mirrors `run_store.py`: a file-backed `ChatStore(db_path)` plus an
`InMemoryChatStore` (single persistent connection) selected when `DB_PATH ==
":memory:"`. Two tables:

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id   TEXT PRIMARY KEY,
    episode_id   TEXT NOT NULL,
    chunk_id     TEXT NOT NULL,
    title        TEXT,            -- NULL until auto-named
    token_count  INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    role         TEXT NOT NULL,   -- "user" | "assistant"
    content      TEXT NOT NULL,
    tool_calls   TEXT,            -- JSON: [{kind, payload}] or NULL
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_chunk ON chat_sessions(episode_id, chunk_id, updated_at);
```

### Public API

```python
class ChatStore:
    def __init__(self, db_path: str = "animatory.db") -> None: ...
    async def init(self) -> None: ...
    async def create_session(self, episode_id: str, chunk_id: str, *, now: str) -> dict: ...
    async def latest_session(self, episode_id: str, chunk_id: str) -> dict | None: ...
    async def list_sessions(self, episode_id: str, chunk_id: str) -> list[dict]: ...
    async def get_session(self, session_id: str) -> dict | None: ...
    async def get_messages(self, session_id: str) -> list[dict]: ...
    async def append_message(self, session_id: str, role: str, content: str,
                             tool_calls: list[dict] | None, *, now: str) -> None: ...
    async def set_title(self, session_id: str, title: str) -> None: ...
    async def set_token_count(self, session_id: str, n: int) -> None: ...
    async def delete_session(self, session_id: str) -> None: ...
```

- Session dict shape: `{session_id, episode_id, chunk_id, title, token_count,
  created_at, updated_at, message_count}` (`message_count` joined in
  list/get for the UI).
- Message dict shape: `{id, role, content, tool_calls, created_at}` (`tool_calls`
  parsed from JSON to a list, or `[]`).
- `append_message` and `set_*` bump the session's `updated_at`.
- `delete_session` removes the session and its messages (explicit delete of both
  rows; no FK cascade reliance).
- Timestamps are caller-supplied ISO strings (`now=`) so routes pass
  `datetime.now(timezone.utc).isoformat()` and tests can be deterministic.
- `create_session` generates `session_id` via `uuid4()`.

---

## Backend routes (in `animatory/pipeline_router.py`)

All under `…/episodes/{episode_id}/chunks/{chunk_id}/chat`. Each validates the
chunk with the existing `_chunk_meta` (404 on unknown episode/chunk). The store
is read from `request.app.state.chat_store` (same pattern the parse route uses
for `request.app.state.store`).

### `GET …/chat/sessions`
List sessions for the chunk, newest first:
`[{session_id, title, token_count, message_count, updated_at}]`.

### `POST …/chat/sessions`
Create an empty session; returns the session dict. Used by **New chat** and
`/clear`.

### `GET …/chat/sessions/{session_id}`
`{session: {...}, messages: [{id, role, content, tool_calls, created_at}]}`.
404 if the session doesn't exist or doesn't belong to this chunk.

### `PATCH …/chat/sessions/{session_id}`
Body `{title: str}` → rename. Returns the updated session. 404 if not found.

### `DELETE …/chat/sessions/{session_id}`
Delete the session + messages. 204/200. 404 if not found.

### `POST …/chat/stream` *(session_id in body)*

The A1 `POST …/chat/stream` route is **replaced** by a server-authoritative
version (same URL; `session_id` travels in the body so a brand-new session —
`null` id — is creatable in the same call). Request body:
```jsonc
{ "session_id": "uuid-or-null",
  "message": "the new user message",
  "thinking": false,
  "mentions": { "scenes": ["C001_S01"], "raw": false } }
```
Behaviour:
1. If `session_id` is null/missing → `create_session(...)`.
2. `append_message(session, "user", message, None)`.
3. Load prior `get_messages(session)` (now including the just-added user turn),
   map to `[{role, content}]`, build context exactly as A1 (scene index, mentioned
   scenes filtered to this chunk, raw text if `@raw`).
4. `stream_chat(...)` as in A1. The route's generator:
   - emits a **`session`** event first: `{session_id}`.
   - relays `thinking`/`reply`/`tool`/`usage`/`error` unchanged, while
     **accumulating** the full reply text, the tool-call list, and the latest
     `usage.prompt_tokens`.
   - on `done` (or stream end): `append_message(session, "assistant", reply,
     tool_calls)`, `set_token_count(session, prompt_tokens)`. If the session had
     no title and this was the **first** user/assistant exchange, call
     `generate_title(...)`, `set_title(...)`, and emit a **`title`** event
     `{title}`. Then relay `done`.
   - on `error`: persist nothing for the assistant turn (the user turn is already
     stored); relay the `error` event.

The request carries `session_id` in the **body** (route stays
`POST …/chat/stream`), so a new session (null id) is creatable in the same call;
the `session` SSE event returns the resolved id.

### Title generation — `chat_engine.generate_title(messages, *, qwen_endpoint=None, model=None) -> str`
A single non-streaming chat completion: "Give a 3-5 word title for this
conversation; reply with only the title." Strips quotes/whitespace; truncates to
~60 chars. On any HTTP/parse failure, returns the first user message truncated to
~40 chars (never raises). Reuses the A1 env vars.

---

## Frontend

### `frontend/src/api/chat.ts`
- `streamChat` body changes to `{ session_id: string | null, message: string,
  thinking: boolean, mentions: ChatMention }`. Handlers gain
  `onSession(sessionId: string)` and `onTitle(title: string)`; `dispatch` maps the
  new `session` / `title` SSE events.
- New types + functions:
  ```ts
  export interface ChatSessionMeta {
    session_id: string; title: string | null; token_count: number
    message_count: number; updated_at: string
  }
  export interface StoredMessage {
    id: number; role: 'user' | 'assistant'; content: string
    tool_calls: { kind: string; payload: unknown }[]; created_at: string
  }
  listSessions(episodeId, chunkId): Promise<ChatSessionMeta[]>
  createSession(episodeId, chunkId): Promise<ChatSessionMeta>
  getSession(episodeId, chunkId, sessionId): Promise<{ session: ChatSessionMeta; messages: StoredMessage[] }>
  renameSession(episodeId, chunkId, sessionId, title): Promise<ChatSessionMeta>
  deleteSession(episodeId, chunkId, sessionId): Promise<void>
  ```

### `RefineChat`
- Header gains a **session control**: the active session's title (or "New chat")
  with a **history** disclosure listing sessions (title · relative time), each
  selectable; an inline **rename** (pencil → text input) and **delete** (with
  confirm) per session; a **New chat** action.
- Messages rendered come from the parent (loaded session messages + the live
  streaming turn). Past assistant turns that carried tool calls render a small
  muted "proposed N edit(s)" footnote (read-only; re-applying is not in A2).
- `/clear` typed as the whole message triggers New chat instead of sending.
- New props: `sessions: ChatSessionMeta[]`, `activeSessionId: string | null`,
  `onSelectSession(id)`, `onNewChat()`, `onRenameSession(id, title)`,
  `onDeleteSession(id)`. (`onNewChat` replaces A1's in-memory reset.)

### `ChapterView`
- On chapter open (after scenes/text load): `listSessions`; if any, `getSession`
  on the latest → populate `messages`, `activeSessionId`, and the `usage` meter
  from its `token_count`; else `activeSessionId = null` (a session is created by
  the first send and its id arrives via `onSession`).
- `runTurn(text, mentions)` now posts `{ session_id: activeSessionId, message:
  text, thinking, mentions }`; `onSession` sets `activeSessionId`; `onTitle`
  updates the session list; `onDone` refreshes the session list (updated_at /
  message_count). The server is the source of truth — the client no longer sends
  the full transcript.
- `onNewChat` → `createSession` → clear `messages`, set active, refresh list.
  `onSelectSession` → `getSession` → load messages. `onDeleteSession` → delete →
  if it was active, fall back to latest or new.

---

## Error handling
- Stream `error` after the user turn is stored: the user message persists, no
  assistant turn; client shows inline error + Retry (re-sends the same message to
  the same session).
- Title generation failure → fallback title; never blocks the turn.
- Deleting the active session → client loads the next latest or starts fresh.
- Unknown/foreign `session_id` (not belonging to the chunk) → 404; client resets
  to a new session.
- `:memory:` DB → `InMemoryChatStore` keeps one connection so sessions persist
  across requests within a process (mirrors `InMemoryRunStore`).

---

## Testing
- `tests/test_chat_store.py` (in-memory): create/list/get ordering (newest
  first), append + `message_count`, `latest_session`, `set_title`/
  `set_token_count` bump `updated_at`, `delete_session` removes messages too.
- `tests/test_pipeline_api.py`:
  - session CRUD: create → list → get → rename → delete; 404 on unknown
    session/chunk.
  - stream route (mocked `stream_chat` + mocked `generate_title`): creates a
    session when id is null, emits `session` first, persists user + assistant
    turns, emits `title` on first exchange, sets `token_count` from usage; a
    second turn on the same session does NOT re-title.
- Frontend (`chat.test.ts`): `listSessions`/`createSession`/`getSession`/
  `renameSession`/`deleteSession` hit the right URLs/methods; `streamChat`
  dispatches `session` and `title` to the new handlers; body includes
  `session_id` + `message`.

Backend tests never hit a live Qwen (engine + titler mocked). `ChatStore` wired
into the test app via the existing lifespan + `DB_PATH=:memory:`.

---

## Definition of Done
- [ ] `ChatStore` + `InMemoryChatStore` pass `tests/test_chat_store.py`
- [ ] `chat_store` wired into `app.state` in the lifespan (file + memory)
- [ ] Stream route is server-authoritative: creates/loads session, persists user
      + assistant turns, emits `session` + `title`, sets `token_count`
- [ ] `generate_title` returns an LLM title with a safe fallback (never raises)
- [ ] Session CRUD routes work with correct 404s; suite green
- [ ] `chat.ts` session functions + `session`/`title` dispatch unit-tested
- [ ] `RefineChat` session switcher: select, New chat, rename, delete, `/clear`
- [ ] `ChapterView` resumes the latest session on open; turns persist; meter
      reflects stored `token_count`
- [ ] `ui-taste` smell test passes for the session UI
- [ ] `tsc` clean, `npm run build` ok, `pytest tests/ -q` green
