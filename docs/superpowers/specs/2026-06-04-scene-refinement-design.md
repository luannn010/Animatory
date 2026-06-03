# Scene Refinement — Text Cleanup, Parse, Edit & Local-LLM Chat on the Chapter Page

**Date:** 2026-06-04
**Status:** Approved

---

## Overview

Turn the read-only Chapter page into an editing workspace for a chunk, covering
the whole **clean → parse → refine** flow against a local LLM (Qwen, already
wired in `animatory/scene_parser.py`):

1. **Clean the raw text first.** An adaptive chat scans the chapter and proposes
   **find→replace corrections** — typos and wrong/inconsistent character names —
   as highlights over the raw text, accepted/rejected individually (with an
   "apply to all occurrences" option). The raw text is also manually editable.
2. **Parse / Re-parse from the chapter page.** A button under the raw text parses
   a chunked-but-unparsed chapter, or re-parses after cleaning. Parsing uses the
   cleaned text when present.
3. **Manually edit scenes** — change any scene's fields.
4. **Refine scenes via the same chat** — once parsed, the chat targets scenes and
   returns **structured per-scene edit proposals** accepted/rejected on the cards.

Both text and scene edits persist to **separate edited copies**
(`{chunk_id}.edited.txt`, `{chunk_id}_scenes.edited.json`), leaving the original
transcript and original Qwen output untouched, each with a **reset** affordance.

This builds on the transcript pipeline
([`2026-06-02-transcript-pipeline-design.md`](2026-06-02-transcript-pipeline-design.md)).
The Chapter page, raw-text view, and read-only scene cards already exist; this
spec adds text cleanup, in-page parsing, scene/text editing, the adaptive chat,
and persistence.

---

## Scope

**In scope:**
- In-page **Parse / Re-parse** button (reuses the existing SSE parse run)
- Editable raw text + highlighted find→replace corrections from the chat
- Editable scene cards (manual edit of existing scenes' fields)
- **One adaptive chat** (shared session transcript) that targets text or scenes
- Backend routes for text save/reset, scene save/reset, refine, and edited-text
  parsing
- `animatory/scene_refiner.py` — Qwen chat for both modes (proofread / refine)
- Tests for the new module and routes

**Out of scope:**
- Adding, removing, splitting, or reordering scenes (scene proposals edit
  existing scenes' fields only) — future enhancement
- Token-streaming chat (v1 is synchronous request/response)
- Chat history persisted across page reloads (session memory is in-memory for
  the visit)
- A mock path for pipeline routes (the chat needs the live backend + LLM)
- Editing scenes while a parse is running

---

## The clean → parse → refine flow

```
chunked, not parsed ──▶ clean raw text (chat: Text) ──▶ Parse ──▶ refine scenes (chat: Scenes)
        ▲                                                 │              │
        └──────────────── Re-parse (after re-cleaning) ◀──┴──────────────┘
```

The chat's target auto-follows this flow (Text before parse, Scenes after) and
can be flipped manually so the user can re-clean text and re-parse.

---

## Behaviour

### Layout

`ChapterView` becomes a two-column workspace on `lg` and wider:

```
┌───────────────────────────────────────┬──────────────────────┐
│  ← Back to parsing                     │  Refine               │
│  EP1                                   │  Acts on: [Text|Scenes]│
│  Chapter C001                          │  ────────────────────  │
│  3,881 words · 8 scenes · ✎ edited     │  (chat messages —      │
│                                        │   one shared session)  │
│  Raw text   [Edit text] ✎ edited       │                        │
│  ┌──────────────────────────────────┐ │  …                     │
│  │ text w/ ⟨highlighted corrections⟩ │ │                        │
│  └──────────────────────────────────┘ │                        │
│              [Reset text] [Parse ▷]    │  ────────────────────  │
│                                        │  [ ask…            ▷ ] │
│  Scenes            [Reset] [Save ●]    │                        │
│  ┌──────────────────────────────────┐ │                        │
│  │ Scene 01            [Edit]        │ │                        │
│  │ …card / inputs / proposal banner… │ │                        │
│  └──────────────────────────────────┘ │                        │
└───────────────────────────────────────┴──────────────────────┘
```

Narrow screens stack: raw text + scenes first, the chat collapses to a toggle.
One accent (`#3772cf`); spacing/radius/color from Tailwind tokens only; no
arbitrary hex/px. The `ui-taste` skill is run before JSX and before done.

### Parse / Re-parse button

Right-aligned **under the raw-text window**:

- **Chunked but not parsed** (the current 409 state) → **"Parse this chapter"**.
- **Already parsed** → **"Re-parse"**, with a confirm: *"Re-parsing replaces the
  extracted scenes; saved scene edits will be discarded."*
- Calls `parseEpisode(episodeId, [chunkId])` and drives progress from the
  existing `/runs/{run_id}/stream` SSE (inline spinner + `[done/total]`). On
  completion it reloads scenes (and, for re-parse, clears any edited-scenes copy
  so the view shows the fresh extraction).
- Parsing **uses `{chunk_id}.edited.txt` when present**, else the original chunk
  text — so cleaning improves extraction.
- Disabled while a parse is running.

### Cleaning the raw text

- The raw-text window supports two things:
  - **Highlighted corrections** from the chat (Text target): each correction is
    a `{find, replace, rationale, all_occurrences}` shown as a `<mark>` over the
    matching span(s), with **Accept / Reject** and an **"apply to all
    occurrences"** toggle (ideal for normalizing a character name everywhere).
    Accept rewrites the working text; Reject dismisses the highlight. A
    correction whose `find` no longer matches is shown as "no longer applies".
  - **Manual edit** via an **Edit text** toggle → the window becomes a textarea
    for hand fixes.
- **Reset text** (shown only when an edited copy exists) deletes
  `{chunk_id}.edited.txt` after a confirm, restoring the original chunk text.
- A dirty indicator marks unsaved text; saving persists via `PUT …/text`.
  (Accepting corrections / manual edits update the working copy; an explicit
  **Save** persists — consistent with scenes.)

### Manual scene editing

- Each scene card has an **Edit** button. In edit mode, fields become controls:
  - `action` — multiline textarea
  - `location`, `mood` — text inputs
  - `characters` — comma-separated input (split/trim on change)
  - `shot_type` — `<select>` (`wide | medium | close-up | insert | POV`)
  - `dialogue` — list of `{character, line}` rows with add / remove
- **Save / Cancel** on the card commit/discard *local* changes into the working
  copy (no network). A chapter-level **Save changes** button (with a dirty `●`)
  persists the whole list via `PUT …/scenes`; disabled when not dirty.
- **Reset to original** (only when an edited copy exists) deletes the edited
  scenes after a confirm.

### Adaptive refine chat

- One sidebar chat, **one shared transcript** (session memory for the visit).
- A compact **"Acts on: Text / Scenes"** control sets the target for the next
  message. It **auto-selects** Text when the chapter is unparsed and Scenes once
  parsed; the user can flip it. **Scenes is disabled until the chapter is
  parsed.**
- **Empty state:** target-aware hint — Text: *"Ask me to scan for typos or fix a
  character's name."* Scenes: *"Ask me to refine these scenes — e.g. make the
  mood darker."*
- On send, the frontend posts `{ messages, target }` to `POST …/refine`. While
  waiting: a **thinking** state (disabled input, spinner). On error (LLM
  unreachable / unparseable), an inline error with **Retry** of the last message.
- Response `{ reply, corrections?, proposals? }`:
  - `reply` is appended as the assistant turn.
  - **Text target →** `corrections[]` surface as highlights over the raw text.
  - **Scenes target →** `proposals[]` `{ scene_id, changes, rationale }` surface
    as a **"Suggested" banner** on the matching card (only changed fields shown),
    with **Accept** (merge into working copy, marks dirty) / **Reject**.
  - Proposals/corrections that no longer apply (unknown `scene_id`, non-matching
    `find`) are skipped with a small "n suggestion(s) skipped" note, never a
    crash.

### State (in `ChapterView`)

| State | Purpose |
|-------|---------|
| `text`, `textBaseline` | working raw text + last-saved snapshot (`textDirty`) |
| `textEdited` | whether the loaded text is the edited copy (badge + reset) |
| `corrections: TextCorrection[]` | pending highlighted text corrections |
| `editingText: bool` | manual textarea toggle |
| `scenes`, `sceneBaseline` | working scene list + snapshot (`scenesDirty`) |
| `scenesEdited` | whether loaded scenes are the edited copy |
| `editing: Set<scene_id>` | which cards are in edit mode |
| `proposals: Record<scene_id, ScenePatch>` | pending scene proposals |
| `parsed: bool`, `parsing: bool` | parse state / in-flight parse |
| `messages: ChatMessage[]`, `target: 'text'\|'scenes'` | chat transcript + target |
| `sending`, `savingText`, `savingScenes` | in-flight flags |

---

## Backend

### Module: `animatory/scene_refiner.py`

Mirrors `scene_parser.py` (httpx → Qwen OpenAI-compatible endpoint, thinking
disabled by default, JSON-only output, retry with exponential backoff). Two
entry points sharing the HTTP/parse plumbing:

```python
async def proofread_text(
    chunk_id, chunk_text, messages, *, qwen_endpoint=None, model=None, max_retries=None,
) -> dict:   # {"reply": str, "corrections": [TextCorrection]}

async def refine_scenes(
    chunk_id, chunk_text, scenes, messages, *, qwen_endpoint=None, model=None, max_retries=None,
) -> dict:   # {"reply": str, "proposals": [SceneProposal]}
```

Both build a prompt from: a system framing (Vietnamese novel-to-animation
assistant), the raw `chunk_text` for grounding, the relevant payload (nothing
extra for text; the current `scenes` JSON for refine), and the user/assistant
`messages`. Each must return ONLY JSON; the same thinking-tag / code-fence
stripping is applied before `json.loads`. On unrecoverable failure, raise
`ValueError` (surfaced as HTTP 502).

**Response schemas:**

```jsonc
// proofread_text
{
  "reply": "string",
  "corrections": [
    { "find": "string", "replace": "string",
      "rationale": "string", "all_occurrences": true }
  ]
}

// refine_scenes
{
  "reply": "string",
  "proposals": [
    { "scene_id": "C001_S02",
      "changes": {  /* only fields to alter */
        "location": "string", "characters": ["string"], "shot_type": "string",
        "action": "string", "mood": "string",
        "dialogue": [{"character": "string", "line": "string"}]
      },
      "rationale": "string" }
  ]
}
```

`corrections` / `proposals` may be empty (pure advice).

### Edited-copy helpers (in `pipeline_router.py`)

- `_text_path` / `_edited_text_path` → `{chunk_id}.txt` (via manifest `file`) /
  `{chunk_id}.edited.txt`
- `_scenes_path` / `_edited_scenes_path` → `{chunk_id}_scenes.json` /
  `{chunk_id}_scenes.edited.json`
- Reads prefer the edited copy when it exists.

### Parsing uses edited text

`parse_episode` (in `scene_parser.py`) resolves each chunk's text via a helper:
use `{chunk_id}.edited.txt` if present, else the manifest `file`. This is the
only change to existing parse code.

### Routes (added/modified in `pipeline_router.py`)

| Method | Route | Behaviour |
|--------|-------|-----------|
| `GET` | `…/chunks/{cid}/text` *(modified)* | Prefer edited copy; add `"edited": bool` |
| `PUT` | `…/chunks/{cid}/text` | Body `{ "text": str }` → write `{cid}.edited.txt`; resp `{…, edited:true}` |
| `DELETE` | `…/chunks/{cid}/text/edited` | Delete edited text; resp original `{…, edited:false}` |
| `GET` | `…/chunks/{cid}/scenes` *(modified)* | Prefer edited copy; add `"edited": bool` |
| `PUT` | `…/chunks/{cid}/scenes` | Body `{ "scenes":[…] }` (validated) → write `{cid}_scenes.edited.json` (`edited_at` stamped); resp `{…, edited:true}` |
| `DELETE` | `…/chunks/{cid}/scenes/edited` | Delete edited scenes; resp original `{…, edited:false}` |
| `POST` | `…/chunks/{cid}/refine` | Body `{ messages, target:"text"\|"scenes" }` → `proofread_text` or `refine_scenes`; resp `{reply, corrections?, proposals?}` |

Errors: `404` (episode/chunk unknown, or no original to edit/refine), `409`
(scenes requested but chunk never parsed), `422` (invalid scene body), `502`
(LLM unreachable/unparseable — message names the endpoint).

The existing `/parse/{episode_id}` route is unchanged (the in-page Parse button
reuses it with a single `chunk_id`). On a **re-parse**, the frontend additionally
calls `DELETE …/scenes/edited` so stale scene edits don't mask the fresh output.

### Listing consistency

`_episode_chunks` counts a chunk as parsed and reports `scene_count` using the
edited scenes copy when present (falls back to original).

### Configuration

Reuses existing Qwen env vars (`QWEN_ENDPOINT`, `QWEN_MODEL`, `QWEN_MAX_RETRIES`,
`QWEN_TIMEOUT_S`, `QWEN_ENABLE_THINKING`). No new variables.

---

## Frontend

### API client (`frontend/src/api/pipeline.ts`)

New types:

```ts
export interface TextCorrection {
  find: string
  replace: string
  rationale: string
  all_occurrences: boolean
}
export interface ScenePatch {
  scene_id: string
  changes: Partial<Omit<PipelineScene, 'scene_id'>>
  rationale: string
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface RefineResult {
  reply: string
  corrections?: TextCorrection[]
  proposals?: ScenePatch[]
}
```

`ChunkText` and `ChunkScenes` gain `edited: boolean`. New functions (existing
`fetch` + error-throwing pattern):

```ts
saveText(episodeId, chunkId, text: string): Promise<ChunkText>
resetText(episodeId, chunkId): Promise<ChunkText>
saveScenes(episodeId, chunkId, scenes: PipelineScene[]): Promise<ChunkScenes>
resetScenes(episodeId, chunkId): Promise<ChunkScenes>
refineChat(episodeId, chunkId, messages: ChatMessage[], target: 'text' | 'scenes'): Promise<RefineResult>
```

(`parseEpisode` and `api.streamRun` already exist and are reused for Parse.)

### Components

- `frontend/src/components/refine/RawTextEditor.tsx` — the raw-text window:
  read/highlight mode (renders text with `<mark>` correction spans + per-mark
  Accept/Reject + "all occurrences"), manual **Edit text** textarea mode, dirty
  indicator, Reset, and the Parse/Re-parse button + inline parse progress.
- `frontend/src/components/refine/EditableSceneCard.tsx` — one card layering
  read / edit (inputs) / proposal-banner states. Props: `scene`, `isEditing`,
  `proposal?`, `onEdit`, `onSaveLocal`, `onCancel`, `onChange`,
  `onAcceptProposal`, `onRejectProposal`.
- `frontend/src/components/refine/RefineChat.tsx` — sidebar: "Acts on" control,
  message list, empty/thinking/error states, input + send. Props: `messages`,
  `target`, `canTargetScenes`, `sending`, `error`, `onSend(text)`,
  `onChangeTarget`, `onRetry`.
- `ChapterView.tsx` — owns all state (table above), the two-column layout, and
  wires chat send → `refineChat` → distribute `corrections` to `RawTextEditor` /
  `proposals` to scene cards; owns Parse, both Save buttons, both Resets.

`SceneList.tsx` stays as the read-only renderer for non-editing contexts.

### States required (ui-taste)

- Chat: empty (target-aware), thinking spinner, error + retry, send disabled when
  empty/sending, Scenes target disabled until parsed.
- Parse: button states (Parse / Re-parse / parsing spinner), confirm on re-parse,
  inline progress, error.
- Text & scenes: dirty indicators, save spinners, save disabled when clean,
  inline save errors, reset confirms.
- Corrections/proposals that no longer apply: skipped with a small note.

---

## Testing

- `tests/test_scene_refiner.py` — mocked `httpx`:
  - `proofread_text` returns `{reply, corrections}`; partial/empty corrections;
    thinking-tag/code-fence stripping; retry on HTTP/JSON failure.
  - `refine_scenes` returns `{reply, proposals}`; partial `changes`; empty
    proposals; retry.
- `tests/test_pipeline_api.py` (extended, `TestClient` + fixture episode):
  - `PUT …/text` writes `{cid}.edited.txt`; `GET …/text` returns it with
    `edited:true`; `DELETE …/text/edited` restores original (`edited:false`).
  - Parse run reads the edited text when present (assert the parsed input).
  - `PUT …/scenes` writes the edited copy; `GET …/scenes` prefers it with
    `edited:true`; unparsed chunk → `404`; invalid body → `422`;
    `DELETE …/scenes/edited` restores original.
  - `POST …/refine` with mocked refiner returns the right shape per `target`
    (`corrections` for text, `proposals` for scenes); unparsed + `target:scenes`
    → `404`; `target:text` works pre-parse.
  - `_episode_chunks` scene_count reflects the edited scenes copy.

All backend tests run without a live Qwen server (the LLM call is mocked).
Manual verification of the live chat path uses the backend + Qwen at `:1090`.

---

## Definition of Done

- [ ] `proofread_text` / `refine_scenes` return their shapes; unit tests pass
- [ ] `PUT/DELETE …/text` persist & reset `{cid}.edited.txt`; `GET …/text`
      prefers it and reports `edited`
- [ ] Parse run uses edited text when present
- [ ] In-page **Parse** works for an unparsed chapter; **Re-parse** warns,
      regenerates scenes, and clears stale edited scenes
- [ ] Raw text shows highlighted find→replace corrections with accept (incl. all
      occurrences) / reject, plus manual edit, save, dirty + edited badge, reset
- [ ] `PUT/DELETE …/scenes` persist & reset the edited scenes copy; `GET …/scenes`
      prefers it and reports `edited`
- [ ] Scene cards edit manually, save, show dirty + edited badge, reset
- [ ] Adaptive chat: one shared session, target auto-follows parse state and is
      switchable, returns corrections (text) or proposals (scenes), with
      thinking/error/retry states
- [ ] `POST …/refine` returns reply + corrections/proposals (404 unparsed for
      scenes, 502 on LLM failure)
- [ ] `ui-taste` smell test passes for the Chapter workspace
- [ ] `pytest tests/test_scene_refiner.py tests/test_pipeline_api.py -v` passes
