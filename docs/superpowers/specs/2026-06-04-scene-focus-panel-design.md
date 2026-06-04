# Scene Focus Panel + Scene Source Location — Design

**Date:** 2026-06-04
**Status:** Approved
**Depends on:** per-scene re-parse (sub-project C), scene refinement chat (A1/A2),
parse enrichment + entity registry (sub-project B)

## 1. Goal & Scope

Make a single scene readable and editable in one focused place. Today the
re-parse "Suggested" proposal renders changed fields as raw `JSON.stringify`
(an unreadable blob for `dialogue`/`narration`), the chapter's refine chat lives
only in the right-hand column, and there is no way to see *where in the chapter
text* a scene was extracted from.

This adds:

1. A **best-effort scene→source locator** (which chapter lines a scene came from).
2. A **Scene Focus panel**: a modal showing one scene rendered readably, its
   source passage highlighted in the chapter text, and the existing refine chat
   (seeded so a prompt carries that scene + its source).
3. `@Scene` mentions now attach the scene **and** its located source passage to
   chat context (previously scene-only; `@raw` still attaches the whole chapter).
4. A shared `SceneReadView` component, reused by the card, the panel, and the
   proposal block — which fixes the unreadable "Suggested" rendering.

No new generation logic. The locator is heuristic string matching; the chat,
re-parse, and save flows are unchanged underneath.

## 2. How a scene is located in the source

The parser does **not** store per-scene source offsets (still Out of Scope, see
the re-parse design §6). So location is **best-effort string matching**, done
fresh from the scene's content against the chapter text:

- Split the chapter text into lines (`splitlines()`, indices are 0-based and
  relative to that same text).
- Build "needles" from the scene: each `dialogue[].line`, each `narration[]`
  string, and `action`.
- Normalize both sides for comparison: lowercase, collapse runs of whitespace to
  one space, strip surrounding quotes and leading dialogue dashes
  (`—`, `–`, `-`), strip outer punctuation. **Keep Vietnamese diacritics** (do
  not accent-fold — `Thế` and `The` are different).
- A chapter line matches a needle if the normalized needle is contained in the
  normalized line (or vice-versa) **and** the needle is at least
  `MIN_NEEDLE_CHARS` (8) long after normalization — avoids trivial matches on
  short interjections.
- Collect all matched line indices (`match_lines`, sorted, de-duplicated). The
  span is `line_start = min`, `line_end = max`. The `excerpt` is the chapter
  lines from `line_start` through `line_end` joined with `\n` (a contiguous
  passage that may include a few unmatched lines between matches — intended, it
  reads as the scene's stretch of text).
- If nothing matches, return `found: false` with empty `match_lines` and
  `line_start = line_end = -1`, `excerpt = ""`.

This lives in a new pure module so it is unit-testable and reused by both the
source endpoint and the chat route (single source of truth).

### 2.1 `animatory/scene_source.py` (new)

```python
MIN_NEEDLE_CHARS = 8

class SceneSource(TypedDict):
    found: bool
    match_lines: list[int]   # 0-based indices into chunk_text.splitlines()
    line_start: int          # min(match_lines), or -1
    line_end: int            # max(match_lines), or -1
    excerpt: str             # lines[line_start..line_end] joined, or ""

def locate(scene: dict, chunk_text: str) -> SceneSource:
    """Best-effort: which chapter lines did this scene come from?
    Heuristic substring matching on dialogue/narration/action. Pure."""
```

## 3. Backend

### 3.1 Source endpoint

```
GET /pipeline/episodes/{episode_id}/chunks/{chunk_id}/scenes/{scene_id}/source
```

- `_chunk_meta` → 404 if episode/chunk unknown.
- `_scenes_payload` (edited-preferred) → 409 if not parsed; find scene by
  `scene_id` → 404 if absent. (Mirrors the re-parse route's guards.)
- `_text_payload` (edited-preferred) → the same text the panel renders, so line
  indices line up.
- Return `locate(scene, text)` as JSON: `{found, match_lines, line_start,
  line_end, excerpt}`.
- Read-only; persists nothing.

The panel already has the full chapter text (`getChunkText`); it highlights
`match_lines` over that text. The endpoint returns `excerpt` too for convenience
/ debugging, but the panel highlights by line index.

### 3.2 `@Scene` attaches located source

`chat_stream` currently builds `mentioned` (full scene dicts) and `raw_text`
(whole chapter iff `mentions.raw`). Change:

- For each mentioned scene, compute `scene_source.locate(scene, chapter_text)`
  and attach its `excerpt` to what's passed downstream. Pass a parallel mapping
  `scene_sources: dict[scene_id, str]` (excerpt, empty if not found) into
  `stream_chat`.
- `chat_engine.stream_chat` / `_build_messages` gain a `scene_sources` argument.
  In the folded system turn, after the "Full detail for mentioned scene(s)" JSON,
  add, per mentioned scene that has a non-empty excerpt:
  `Source passage for {scene_id}:\n---\n{excerpt}\n---`.
- `@raw` is unchanged (whole chapter, independent of scene mentions).
- The chapter text used for matching is the edited-preferred `_text_payload`
  text already loaded in the route.

`ChatMentions` stays `{scenes, raw}` — the frontend mention payload does **not**
change; the backend does the bundling. `_build_messages` keeps emitting exactly
one leading system message (see the chat-engine dual-system-message fix).

## 4. Frontend

### 4.1 `pipeline.ts`

`getSceneSource(episodeId, chunkId, sceneId): Promise<SceneSource>` where
`SceneSource = { found, match_lines, line_start, line_end, excerpt }`.

### 4.2 `SceneReadView` (new shared component)

Extract the **read-mode** rendering currently inline in `EditableSceneCard`
(action line, tag chips, dialogue `dt/dd` rows with emotion·intensity badges,
narration list) into `SceneReadView` taking a `PipelineScene`. No behavior
change for the card. Reused by:

- `EditableSceneCard` read mode (refactor, identical output).
- The **proposal block**: instead of `key: JSON.stringify(value)`, merge the
  proposal `changes` onto the scene and render the result with `SceneReadView`
  under the "Suggested" header, keeping the existing Accept/Reject buttons and
  rationale. This is what fixes the screenshot.
- The focus panel.

### 4.3 `SceneFocusPanel` (new modal/drawer)

Opened by a **Focus** control added to `EditableSceneCard`'s read-mode header
(beside Re-parse / Edit). Props: the scene, its pending proposal (if any), the
source-fetch state, accept/reject/edit callbacks, and the chat element to host.

Regions:
- **Scene** — `SceneReadView` of the current scene. If a proposal is pending for
  this scene, also show the proposed version via `SceneReadView` under a
  "Suggested" header with Accept/Reject (same handlers as the card).
- **Source text** — the full chapter text; lines in `match_lines` highlighted
  (accent left-border + subtle bg), auto-scrolled to `line_start`. States:
  loading (skeleton), `found:false` ("Couldn't locate this scene in the source"
  + show full text un-highlighted), fetch error (inline message).
- **Chat** — the **existing** `RefineChat`, relocated into the panel while it is
  open (same ChapterView state/session — *not* a second chat instance), composer
  pre-seeded with `@SceneNN `.

### 4.4 `ChapterView` wiring

- `focusedSceneId: string | null` state; `Focus` sets it, panel close clears it.
- `sceneSource` state: `{ loading, data | null, error }`; fetched via
  `getSceneSource` when `focusedSceneId` changes (abort/ignore stale on rapid
  change or unmount).
- Seed the chat composer with `@SceneNN ` when the panel opens. Implemented by a
  new optional `seedDraft` prop on `RefineChat` (sets the composer text once when
  it changes); ChapterView computes `@Scene{NN}` from the focused scene's id.
- **Single chat instance:** render `RefineChat` in the right column when no scene
  is focused, and inside `SceneFocusPanel` when one is. Same element, same props,
  same state — proposals from chat still land on the cards underneath.
- Existing per-scene re-parse, proposal accept/reject, and save flows are
  untouched; the panel reuses their handlers.

### 4.5 ui-taste

One accent `#3772cf`; token-only spacing/radius/color; pill/rounded conventions;
real loading / empty / no-match / error states; focus-visible rings on the Focus
button, close button, and any panel controls; restrained motion on open/close;
no emoji. Modal: scrim, `Esc` to close, focus trapped, scroll-locked body,
`aria-modal`/labelled heading. Run the `ui-taste` smell test before done.

## 5. Testing

**Backend**
- `scene_source.locate` (pure unit tests, using the ep02 / `new1__test`
  fixtures): finds the right line span for a known scene; matches dialogue lines
  that appear after a `—` dash; ignores sub-`MIN_NEEDLE_CHARS` needles; returns
  `found:false` for a scene whose lines don't appear; line indices are valid
  against `chunk_text.splitlines()`; Vietnamese diacritics are preserved (a
  diacritic-mismatched needle does **not** match).
- Source route: returns the locator result; 404 unknown chunk/scene; 409 not
  parsed; uses edited text + edited scenes when present.
- `chat_stream` / `_build_messages`: a mentioned scene injects a
  `Source passage for {scene_id}` block built from its excerpt; still exactly one
  leading system message; `@raw` still attaches the whole chapter; a mention with
  no source match injects no passage block (and does not error).

**Frontend**
- `getSceneSource` client via fetch-mock (URL, method GET, returns the shape).
- Components verified by `npm run build` (no DOM test lib, per project
  convention). `SceneReadView` extraction is behaviour-preserving for the card.

## 6. Out of Scope

- Real per-scene source offsets in the parser schema (still heuristic matching).
- Persisting or learning from re-parse results.
- A second/independent chat session scoped per-scene (the panel hosts the
  existing chapter chat, seeded with `@Scene`).
- Editing the source text from inside the panel (use the existing RawTextEditor).
- Fuzzy/approximate matching beyond normalized substring containment.
