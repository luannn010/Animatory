# Scene Refinement — Edit + Local-LLM Chat on the Chapter Page

**Date:** 2026-06-04
**Status:** Approved

---

## Overview

Turn the read-only Chapter page into an editing workspace for a chunk's parsed
shot list. The user can:

1. **Manually edit** any scene's fields (action, location, characters, shot
   type, mood, dialogue lines).
2. **Refine via a local-LLM chat sidebar** — talk to Qwen about the chapter; the
   model returns a short reply plus **structured per-scene edit proposals** the
   user accepts or rejects on the matching scene card.

Edits persist to a **separate edited copy** (`{chunk_id}_scenes.edited.json`),
leaving the original Qwen output untouched, with a **Reset to original**
affordance.

This builds directly on the transcript pipeline
([`2026-06-02-transcript-pipeline-design.md`](2026-06-02-transcript-pipeline-design.md)).
The Chapter page, raw-text view, and read-only scene cards already exist; this
spec adds editing, the refine chat, and persistence.

---

## Scope

**In scope:**
- Editable scene cards (manual edit of existing scenes' fields)
- Refine chat sidebar driving structured edit proposals (accept/reject)
- Backend save / refine / reset routes + edited-copy persistence
- `animatory/scene_refiner.py` (Qwen chat→`{reply, proposals}`)
- Tests for the new module and routes

**Out of scope:**
- Adding, removing, splitting, or reordering scenes (proposals edit existing
  scenes' fields only) — noted as a future enhancement
- Editing the raw chapter text (stays read-only reference)
- Token-streaming chat (v1 is synchronous request/response)
- Persisted chat history (conversation is ephemeral per page visit)
- A mock path for pipeline routes (refine needs the live backend + LLM, same as
  the existing parse step)

---

## Behaviour

### Layout

`ChapterView` becomes a two-column workspace on `lg` and wider:

```
┌───────────────────────────────────────┬──────────────────────┐
│  ← Back to parsing                     │  Refine                │
│  EP1                                   │  ────────────────────  │
│  Chapter C001                          │  (chat messages)       │
│  3,881 words · 8 scenes · ✎ edited     │                        │
│                                        │  …                     │
│  Raw text  (read-only, unchanged)      │                        │
│  ┌──────────────────────────────────┐ │                        │
│  │ pre … scrollable …               │ │                        │
│  └──────────────────────────────────┘ │  ────────────────────  │
│                                        │  [ ask to refine…  ▷ ] │
│  Scenes            [Reset] [Save ●]    │                        │
│  ┌──────────────────────────────────┐ │                        │
│  │ Scene 01            [Edit]        │ │                        │
│  │ …card / inputs / proposal banner… │ │                        │
│  └──────────────────────────────────┘ │                        │
└───────────────────────────────────────┴──────────────────────┘
```

On narrow screens it stacks: scenes first, the chat collapses to a toggle below
(button → expandable panel). One accent (`#3772cf`); spacing/radius/color from
Tailwind tokens only; no arbitrary hex/px. The `ui-taste` skill is run before
JSX and before the work is called done.

### Manual editing

- Each scene card has an **Edit** button. In edit mode, fields become controls:
  - `action` — multiline textarea
  - `location`, `mood` — text inputs
  - `characters` — comma-separated text input (split/trim on change)
  - `shot_type` — `<select>` (`wide | medium | close-up | insert | POV`)
  - `dialogue` — list of `{character, line}` rows with add / remove
- **Save / Cancel** on the card commit or discard *local* changes into the
  page's working copy. Editing does not hit the network.
- A chapter-level **Save changes** button (with a dirty `●` indicator) persists
  the entire working list via `PUT …/scenes`. Disabled when not dirty.
- **Reset to original** (shown only when an edited copy exists) deletes the
  edited copy after a confirm, reloading the original scenes.

### Refine chat → proposals

- The sidebar is a standard chat: scrollable message list + input + send.
- **Empty state:** "Ask the assistant to refine these scenes — e.g. *make the
  mood darker* or *tighten the dialogue in scene 3*."
- On send, the frontend posts the full conversation to
  `POST …/refine`. While waiting, a **thinking** state shows (disabled input,
  spinner). On error (LLM unreachable / bad response), an inline error with a
  **Retry** of the last message.
- The response is `{ reply, proposals }`:
  - `reply` is appended to the chat as the assistant turn.
  - Each `proposal` `{ scene_id, changes, rationale }` surfaces as a
    **"Suggested" banner** on the matching scene card, rendering the proposed
    field values (only the changed fields) and the rationale, with
    **Accept / Reject**.
  - **Accept** merges `changes` into the working copy (marks dirty; still
    requires Save to persist). **Reject** dismisses the banner.
  - A proposal whose `scene_id` is not in the current list is ignored
    gracefully (logged to console, surfaced as "1 suggestion skipped").
- Proposals are field-level edits of existing scenes only.

### State (in `ChapterView`)

| State | Purpose |
|-------|---------|
| `scenes` | working copy (editable) |
| `baseline` | last-saved snapshot — `dirty = scenes !== baseline` |
| `edited` | whether the loaded doc is the edited copy (drives badge + Reset) |
| `editing: Set<scene_id>` | which cards are in edit mode |
| `proposals: Record<scene_id, ScenePatch>` | pending LLM proposals |
| `messages: ChatMessage[]` | ephemeral chat transcript |
| `sending`, `saving` | in-flight flags for spinners/disabled states |

---

## Backend

### Module: `animatory/scene_refiner.py`

Mirrors `scene_parser.py` (httpx → Qwen OpenAI-compatible endpoint, thinking
disabled by default, JSON-only output, retry with exponential backoff).

```python
async def refine_scenes(
    chunk_id: str,
    chunk_text: str,
    scenes: list[dict],
    messages: list[dict],          # [{role: "user"|"assistant", content: str}]
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> dict:                          # {"reply": str, "proposals": [SceneProposal]}
    ...
```

Prompt construction:
- System framing: a Vietnamese novel-to-animation assistant helping refine an
  existing shot list; must return ONLY JSON matching the response schema.
- Context: the raw `chunk_text` (grounding) + the current `scenes` JSON.
- The user/assistant `messages` as the conversation.
- Response schema (model must return exactly this, no prose/markdown):

```json
{
  "reply": "string — short natural-language answer to the user",
  "proposals": [
    {
      "scene_id": "C001_S02",
      "changes": {
        "location": "string (optional)",
        "characters": ["string"],
        "shot_type": "string (optional)",
        "action": "string (optional)",
        "mood": "string (optional)",
        "dialogue": [{"character": "string", "line": "string"}]
      },
      "rationale": "string — why this change"
    }
  ]
}
```

`changes` contains only the fields the model wants to alter. `proposals` may be
empty (pure advice). The same thinking-tag / code-fence stripping as
`scene_parser.py` is applied before `json.loads`. On unrecoverable failure,
raise `ValueError` (surfaced as HTTP 502 by the route).

### Edited-copy helpers (in `pipeline_router.py`)

- `_scenes_path(ep_dir, chunk_id)` → original `{chunk_id}_scenes.json`
- `_edited_path(ep_dir, chunk_id)` → `{chunk_id}_scenes.edited.json`
- Reads prefer the edited copy when it exists.

### Routes (added to `pipeline_router.py`)

#### `GET …/chunks/{chunk_id}/scenes` *(modified)*
- Returns the **edited copy if present**, else the original.
- Response gains `"edited": true|false`.
- Errors unchanged: `404` (episode/chunk unknown), `409` (not parsed yet —
  neither file exists).

#### `PUT …/chunks/{chunk_id}/scenes`
- **Body:** `{ "scenes": [ <full scene list> ] }`
- Validates each scene against the scene shape (Pydantic): `scene_id`,
  `location`, `characters[]`, `shot_type`, `action`, `dialogue[]`, `mood`.
- Writes `{chunk_id}_scenes.edited.json` with `chunk_id`, `source_file`,
  `model` (carried from original or `"manual"`), `parsed_at` (preserved),
  `edited_at` (now, UTC), `scenes`.
- **Response:** the saved doc with `"edited": true`.
- **Errors:** `404` if the chunk was never parsed (no original to edit);
  `422` on invalid scene shape.

#### `POST …/chunks/{chunk_id}/refine`
- **Body:** `{ "messages": [{role, content}] }`
- Loads current scenes (edited copy if present, else original) + raw chunk text,
  calls `refine_scenes(...)`.
- **Response:** `{ "reply": str, "proposals": [...] }`
- **Behaviour:** synchronous. **Errors:** `404` (not parsed), `502` if the LLM
  is unreachable or returns unparseable output (message names the endpoint).

#### `DELETE …/chunks/{chunk_id}/scenes/edited`
- Deletes `{chunk_id}_scenes.edited.json` if present.
- **Response:** the original scenes doc with `"edited": false`.
- **Errors:** `404` if no original exists.

### Listing consistency

`_episode_chunks` counts a chunk as parsed and reports `scene_count` using the
edited copy when present (falls back to original), so the parse view's scene
counts reflect edits.

### Configuration

Reuses the existing Qwen env vars (`QWEN_ENDPOINT`, `QWEN_MODEL`,
`QWEN_MAX_RETRIES`, `QWEN_TIMEOUT_S`, `QWEN_ENABLE_THINKING`). No new variables.

---

## Frontend

### API client (`frontend/src/api/pipeline.ts`)

New types:

```ts
export interface ScenePatch {
  scene_id: string
  changes: Partial<Omit<PipelineScene, 'scene_id'>>
  rationale: string
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface RefineResult { reply: string; proposals: ScenePatch[] }
```

`ChunkScenes` gains `edited: boolean`. New functions:

```ts
saveScenes(episodeId, chunkId, scenes: PipelineScene[]): Promise<ChunkScenes>
refineScenes(episodeId, chunkId, messages: ChatMessage[]): Promise<RefineResult>
resetScenes(episodeId, chunkId): Promise<ChunkScenes>
```

All follow the existing `fetch` + error-throwing pattern in the file.

### Components

- `frontend/src/components/refine/EditableSceneCard.tsx` — one card with three
  visual states layered: read (mirrors current `SceneList` card styling), edit
  (inputs), and an optional **proposal banner** (Accept/Reject). Props:
  `scene`, `isEditing`, `proposal?`, and callbacks `onEdit`, `onSaveLocal`,
  `onCancel`, `onChange`, `onAcceptProposal`, `onRejectProposal`.
- `frontend/src/components/refine/RefineChat.tsx` — the sidebar: message list,
  empty/thinking/error states, input + send. Props: `messages`, `sending`,
  `error`, `onSend(text)`, `onRetry`. It reports proposals up via the send
  result handled in `ChapterView` (the chat itself only renders `reply` turns).
- `ChapterView.tsx` — owns all state (table above), two-column layout, the
  chapter-level Save / Reset / dirty indicator and edited badge, and wires the
  chat send → `refineScenes` → distribute proposals onto cards.

`SceneList.tsx` stays as the read-only renderer for any non-editing context.

### States required (ui-taste)

- Chat: empty, thinking (spinner), error + retry, send disabled when input empty
  or while sending.
- Save: spinner while saving, disabled when not dirty, inline error on failure.
- Reset: confirm before discarding the edited copy; spinner; inline error.
- Proposal for unknown scene: skipped with a small "n suggestion(s) skipped"
  note rather than a crash.

---

## Testing

- `tests/test_scene_refiner.py` — mocked `httpx`: verifies the `{reply,
  proposals}` shape parses, thinking-tag/code-fence stripping, partial
  `changes`, empty `proposals`, and retry on HTTP/JSON failure.
- `tests/test_pipeline_api.py` (extended, using `TestClient` + a fixture
  episode):
  - `PUT …/scenes` writes `*_scenes.edited.json`; `GET …/scenes` then returns it
    with `edited: true`.
  - `PUT` on an unparsed chunk → `404`; invalid scene body → `422`.
  - `DELETE …/scenes/edited` removes the copy; `GET` returns original with
    `edited: false`.
  - `POST …/refine` with a mocked `refine_scenes` returns `{reply, proposals}`;
    unparsed chunk → `404`.
  - `_episode_chunks` scene_count reflects the edited copy.

All backend tests run without a live Qwen server (the LLM call is mocked).
Manual verification of the live chat path uses the running backend + Qwen at
`:1090`.

---

## Definition of Done

- [ ] `scene_refiner.refine_scenes()` returns `{reply, proposals}`; unit tests pass
- [ ] `PUT …/scenes` persists an edited copy; `GET …/scenes` prefers it and
      reports `edited`
- [ ] `DELETE …/scenes/edited` resets to original
- [ ] `POST …/refine` returns reply + proposals (404 unparsed, 502 on LLM failure)
- [ ] Chapter page edits scenes manually, saves, shows dirty + edited badge,
      resets to original
- [ ] Refine chat sends, shows thinking/error states, and surfaces accept/reject
      proposals on the right scene cards
- [ ] `ui-taste` smell test passes for the Chapter workspace
- [ ] `pytest tests/test_scene_refiner.py tests/test_pipeline_api.py -v` passes
