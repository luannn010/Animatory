# Per-Scene Re-parse (Sub-project C) — Design

**Date:** 2026-06-04
**Status:** Approved
**Depends on:** parse enrichment + entity registry (sub-project B)

## 1. Goal & Scope

Add a **Re-parse** action to each scene card that re-extracts that *one* scene
fresh from the chapter source — fixing wrong speaker attribution,
narration-vs-dialogue, name/location spelling, and emotions — **without**
disturbing the other scenes or their saved edits. The re-extracted scene arrives
as an **accept/reject proposal** on the card, reusing the existing proposal
mechanism (chat suggestions / A1).

No new generation logic. This is a focused second use of the existing parser,
built on B's enriched scene schema (`emotion`/`intensity`/`narration`) and the
per-episode canonical-entity registry.

## 2. How one scene is re-extracted

The pipeline does **not** store per-scene source offsets, so re-parse sends the
**whole chunk text + the scene's current data as an anchor**, instructing the
model to locate and re-extract **only** that scene and return a single corrected
scene object with the **same `scene_id`** and the enriched schema.

The entity registry is **consulted** (known-names hint in the prompt) and the
returned scene is **deterministically normalized** (`registry.normalize_scene`).
It is **not** learned: the proposal may be rejected, and learning from
un-accepted output would pollute the registry. New names still get learned by the
next full parse or added via the entity panel (B).

## 3. Backend

### 3.1 Refactor — shared Qwen call

Extract the Qwen request / retry-backoff / thinking-strip / markdown-fence /
JSON-parse logic currently inline in `scene_parser.parse_chunk` into a shared
helper so both full parse and single-scene re-parse use it (DRY; addresses a note
from B's review that this logic was inline):

```python
async def _call_qwen(
    prompt: str,
    *,
    label: str,                 # for log lines, e.g. chunk_id or scene_id
    endpoint: str,
    model_name: str,
    retries: int,
    timeout_s: float,
    enable_thinking: bool,
) -> dict:
    """POST one chat-completion, strip thinking + fences, return parsed JSON.
    Retries with exponential backoff. Raises ValueError after `retries` attempts."""
```

`parse_chunk` is refactored to build its prompt, call `_call_qwen`, then continue
with normalize → learn → save exactly as today. Behaviour is unchanged; existing
`parse_chunk` tests must stay green.

### 3.2 `reparse_scene`

```python
async def reparse_scene(
    chunk_id: str,
    chunk_text: str,
    anchor_scene: dict,
    registry: EntityRegistry,
    *,
    scene_id: str,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> dict:
    """Re-extract a single scene. Builds a single-scene prompt (whole chunk +
    anchor + known names), calls _call_qwen, takes the one returned scene, forces
    scene_id, normalizes via the registry, and returns it. No file writes, no
    learn, no registry save."""
```

Prompt shape (single object, not an array): re-extract ONE scene, keep
`scene_id`, fix mistakes (speaker attribution, narration vs dialogue,
name/location spelling, emotions); includes the anchor scene JSON (to locate the
passage) and the known-names hint; ends with the full chapter text. If the model
returns `{"scenes": [obj]}` instead of a bare object, take the first element.
Always overwrite the returned `scene_id` with the requested one.

### 3.3 Route

```
POST /pipeline/episodes/{episode_id}/chunks/{chunk_id}/scenes/{scene_id}/reparse
```

- 404 if the chunk is unknown / not chunked (via `_chunk_meta`).
- Load chunk text (edited `.edited.txt` preferred, else original) — same
  precedence `parse_episode` uses.
- Load current scenes via `_scenes_payload` (edited copy preferred); find the
  scene by `scene_id` → 404 if absent; 409 if the chunk isn't parsed yet.
- Load the registry, call `reparse_scene`, return `{"scene": <normalized scene>}`.
- Does **not** persist — the frontend applies via the existing save flow.

## 4. Frontend

- **`pipeline.ts`**: `reparseScene(episodeId, chunkId, sceneId): Promise<{ scene: PipelineScene }>`.
- **EditableSceneCard**: a **Re-parse** button in read mode (beside Edit), with a
  per-card loading/disabled state while in flight (`reparsing` prop, `onReparse`
  callback). Hidden/irrelevant in edit mode.
- **ChapterView**:
  - `reparsing: Set<string>` state (scene_ids in flight).
  - `onReparseScene(sceneId)`: add to `reparsing`; call `reparseScene`; on success
    set a **proposal** for that `scene_id` whose `changes` are the full
    re-extracted scene fields (everything except `scene_id`) with rationale
    "Re-parsed from source"; remove from `reparsing`. A re-parse proposal
    replaces any existing proposal on that card (proposals are keyed by
    `scene_id`).
  - Accept (existing `acceptProposal`) merges the proposal into local scene state
    → user clicks **Save changes** as usual. Reject (existing `rejectProposal`)
    discards.
  - On failure: clear the in-flight flag and show a small inline error near the
    scenes header (dismissed on next action). No crash.
- ui-taste pass on the new button + states (one accent `#3772cf`, token-only,
  real loading/disabled states, focus ring, no emoji).

## 5. Testing

**Backend**
- `_call_qwen` still drives `parse_chunk` — existing `parse_chunk` /
  `parse_episode` tests stay green (refactor is behaviour-preserving).
- `reparse_scene` (mocked Qwen): returns a single normalized scene; forces the
  requested `scene_id` even if the model returns a different one; handles a
  `{"scenes":[obj]}` wrapper; applies registry normalization; does **not** write
  any file and does **not** modify the registry on disk.
- Route: returns `{scene}`; 404 for unknown `scene_id`; 409 if not parsed;
  prefers edited text + edited scenes.

**Frontend**
- `reparseScene` client via fetch-mock (URL, method POST, returns the scene).
- Components verified by `npm run build` (no DOM lib, per project convention).

## 6. Out of Scope

- Per-scene source-offset storage in the parser schema.
- A free-text "hint" passed with the re-parse (the refine chat already covers
  guided, instruction-driven scene edits).
- Persisting or learning from the re-parse result.
- Bulk "re-parse all flagged scenes".
- Richer proposal rendering for dialogue/narration than the existing
  key→value "Suggested" block (acceptable for MVP; reuse as-is).
