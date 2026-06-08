# Streaming Spell-Check (offset model + WebSocket) — Design

> **Date:** 2026-06-08
> **Status:** Approved, pending implementation
> **Supersedes:** the one-shot pre-parse spell-check wired in commit
> `cf6d8df feat(spellcheck): wire pre-parse spell-check end-to-end`
> **Source brief:** `SPELLCHECK_HANDOFF.md` (chunked streaming spell/grammar/naming
> check + interactive suggestion replacer)

## 1. Goal

Replace the current one-shot pre-parse spell-check with a **chunked, streaming**
checker. The chapter editor buffer is split into 5–7 boundary-safe segments;
each segment is checked by Qwen independently; findings stream back over a
WebSocket as each segment completes; the user reviews them in a full-width
overlay and accepts/edits/applies each suggested replacement. A final
cross-segment naming pass catches inconsistent proper nouns (e.g. "Sarah" in
segment 1 vs "Sara" in segment 5).

Findings are **offset-based** (`char_start`/`char_end` into the full document),
not string-match based. This is the load-bearing change: it enables precise,
order-stable application of length-changing replacements.

## 2. Scope decisions (locked)

- **Full rebuild per the handoff**, swapping out the one-shot path.
- **Transport: WebSocket** (the handoff §5 contract). This is the one transport
  not otherwise used in the repo (everything else is SSE via
  `EventSourceResponse`); it is added additively and does not touch SSE chat/parse.
- **UI: full-width overlay/panel.** The editor stays untouched underneath; the
  "Spell check" button opens the overlay.

## 3. Deviations from the handoff (forced by the actual repo)

1. **Backend is `animatory/`, not `backend/`.** New modules live under
   `animatory/spellcheck/` and the WS route is mounted on the existing
   `pipeline_router`.
2. **TypeScript, not JSX.** Frontend files are `.tsx`/`.ts`. Follow the
   `ui-taste` skill and design tokens: one accent `#3772cf`, `border-hairline`,
   `bg-canvas`, `text-ink`/`text-steel`/`text-stone`, `rounded-lg`/`rounded-md`,
   no arbitrary hex/px.
3. **WebSocket base URL.** Add `WS_BASE_URL` to `frontend/src/config.ts`, derived
   from `API_BASE_URL` (http→ws, https→wss).
4. **Naming collision.** The handoff's "chunks" are spell-check sub-chunks of the
   editor buffer. The repo already calls episode chapters "chunks". To avoid
   confusion, the spell-check sub-chunks are named **segments** in code; the WS
   event names keep the handoff's `chunk_*` wire names for contract fidelity, but
   carry segment indices.

## 4. What gets removed / kept / added

### Remove (old one-shot path)
- `animatory/scene_parser.py`: `spellcheck_text()`, `_SPELLCHECK_TEMPLATE`
- `animatory/pipeline_router.py`: `SpellcheckRequest`, `POST .../spellcheck`,
  and the `spellcheck_text` import
- `frontend/src/api/pipeline.ts`: `spellcheckText()`
- `RawTextEditor` / `ChapterView`: the one-shot `onSpellcheck` network call and
  the `spellchecking` loading state tied to it

### Keep (chat depends on these — do not touch)
- `TextCorrection` type, `frontend/src/components/refine/corrections.ts`, and the
  correction cards in `RawTextEditor`. These are populated by the **chat** tool
  (`chat_engine.py` → `text_corrections`), which is independent of
  `spellcheck_text`. Chat still surfaces find/replace cards exactly as before.
- Shared Qwen helpers in `scene_parser.py` — `_call_qwen`, `_qwen_env`,
  `_THINKING_RE`. The new checker **reuses** these (import), never duplicates.

### Add (new feature, parallel to chat)
```
animatory/spellcheck/
  __init__.py
  chunker.py        # split editor text into 5-7 boundary-safe segments + char_offset
  checker.py        # per-segment Qwen call -> offset-based findings (reuses _call_qwen)
  naming_pass.py    # cross-segment naming consistency (edit-distance clustering)
  router.py         # APIRouter with @router.websocket(.../spellcheck/ws)
frontend/src/spellcheck/
  SpellCheck.tsx        # full-width overlay: DocView + finding list + toolbar
  FindingCard.tsx       # one finding row: original->suggestion, editable input, Replace
  DocView.tsx           # rendered document, colored highlights, click-to-apply
  useSpellCheckWS.ts    # WS hook: connect, send {action:start}, collect findings
  offsets.ts            # global offset-shift logic (section 7) - unit-tested
```

## 5. Data model (handoff §2)

### Finding (the atom)
```ts
interface Finding {
  type: 'spelling' | 'grammar' | 'naming'
  original: string
  suggestion: string
  char_start: number   // GLOBAL offset into the full editor text
  char_end: number     // exclusive; text.slice(char_start, char_end) === original
  reason: string
}
```
- `char_start`/`char_end` are offsets into the **full document**, never the
  segment. The backend converts segment-local → global before sending.
- The frontend always works in global offsets and re-verifies `slice === original`
  before applying (section 7.4).

### Segment metadata (internal to backend)
```ts
interface Segment {
  segment_index: number
  char_offset: number   // segment start position in the full document
  text: string
  word_count: number
}
```
`char_offset` is added to each finding's local positions for that segment.

## 6. Chunker rules (`chunker.py`)

- Target 5–7 segments for ~3,800 words → roughly 550–760 words each
  (target word count configurable; default chosen from total length).
- **Never split mid-sentence.** Split on paragraph boundaries first; if one
  paragraph exceeds the target size, fall back to sentence boundaries.
- Record each segment's `char_offset` as a cumulative character count, including
  the whitespace/newlines between segments. Do not normalize or trim in a way
  that loses characters — offsets must map back to the *exact* original string.
- Return segments in document order with stable `segment_index`.
- **Acceptance test:** reconstructing the document from segment
  `char_offset`+`text` equals the original byte-for-byte. If it can't be
  reconstructed exactly, offsets are wrong — fix before anything else.

## 7. The global offset rule (`offsets.ts`, unit-tested — the correctness core)

1. **Backend → global offsets.** Each finding's `char_start`/`char_end` already
   has the segment's `char_offset` added before it is streamed.
2. **Single replacement shifts later findings.** When the user applies finding `f`:
   ```
   delta = f.suggestion.length - (f.char_end - f.char_start)
   for each other unapplied finding o:
     if o.char_start >= f.char_end:
       o.char_start += delta
       o.char_end   += delta
   ```
3. **"Accept all" applies back-to-front.** Sort unapplied findings by `char_start`
   descending and apply highest-offset-first, so earlier offsets stay valid
   without recomputation.
4. **Verify before replacing.** Before applying, check
   `text.slice(char_start, char_end) === original`. On mismatch (user hand-edited
   the text), do NOT blindly splice — fall back to a nearest-match search for
   `original` near the expected offset, or skip and mark the finding stale.
5. **Overlapping findings.** If two findings overlap, render only the first in
   document order and drop/skip the second.

## 8. WebSocket contract (`router.py` + `useSpellCheckWS.ts`, handoff §5)

- Endpoint:
  `ws .../pipeline/episodes/{episode_id}/chunks/{chunk_id}/spellcheck/ws`
- Open the WS **before** kicking off the LLM calls so no events are missed.
- Client → server (start):
  ```json
  { "action": "start", "document": "<full text>" }
  ```
- Server → client events (streamed):
  ```json
  { "type": "chunk_started",  "chunk_index": 0, "total_chunks": 6 }
  { "type": "chunk_findings", "chunk_index": 0, "findings": [ ...global offsets... ] }
  { "type": "naming_findings", "findings": [ ... ] }
  { "type": "complete", "total_findings": 14 }
  { "type": "error", "chunk_index": 3, "message": "..." }
  ```
- Stream `chunk_findings` as soon as each segment's Qwen call returns — findings
  populate progressively.
- `naming_findings` arrives after all segments (the global second pass).
- One failed segment emits `error` for that segment and must NOT abort the others.
- The episode's known names are loaded server-side (as today) so proper nouns are
  not flagged as spelling errors.

## 9. Backend checking (`checker.py`) + naming pass (`naming_pass.py`)

### Per-segment (`checker.py`)
- System prompt demands **JSON only** — no preamble, no markdown fences.
- Strip the Qwen thinking block before parsing (reuse `_THINKING_RE`); parse only
  the final structured answer.
- Parse defensively: strip stray ``` fences, `try/except`; on parse failure emit
  an `error` event for that segment rather than crashing the stream.
- Drop findings whose `original` is not an exact substring at the expected
  local span (so every finding is applyable on arrival).
- **Cache** per segment keyed by `sha256(segment_text)` (in-process dict mapping
  hash → segment-local findings). On a re-run, only re-check segments whose text
  actually changed.
- Reuse `_call_qwen` / `_qwen_env` from `scene_parser.py` for the HTTP call,
  retries, and thinking-strip.

### Naming pass (`naming_pass.py`)
Per-segment checking can't see that "Sarah" became "Sara" across segments.
After all segments return:
1. Collect candidate proper nouns / named entities across the whole document.
2. Cluster near-duplicates by edit-distance (deterministic, no extra tokens —
   chosen over a second LLM pass).
3. For each cluster, pick the dominant spelling and emit `naming` findings for
   the minority spellings, with **global** offsets.

Built last; the rest of the feature works without it.

## 10. Frontend behavior

- **Trigger.** The "Spell check" button in `RawTextEditor` opens the `SpellCheck`
  overlay (no network on click). The editor sits untouched underneath.
- **`DocView`.** Renders the document with each unapplied finding highlighted,
  colored by type (spelling / grammar / naming). Clicking a highlight applies
  that finding.
- **`FindingCard`.** Shows `original → suggestion`, the reason, an **editable
  input** pre-filled with the suggestion (user can change the wording before
  applying), and a Replace button. Applied cards show a muted "applied" state.
- **Toolbar.** "Accept all", "Reset", "Copy text", and a remaining-count.
- **Progressive fill.** As `chunk_findings` events arrive, append to the findings
  list; show a per-segment progress indicator (`segment_index / total`).
  `naming_findings` append at the end.
- **Write-back.** On apply/close, the corrected text flows back to
  `ChapterView`'s `text` state, so the existing **Save text** / **Parse** flows
  work unchanged. Chat-driven `TextCorrection` cards are unaffected.
- **Styling.** Follow `ui-taste` and existing design tokens; do not invent a new
  visual system.

## 11. Build order (handoff §8)

1. `chunker.py` + reconstruction unit test (section 6 acceptance check).
2. `offsets.ts` + unit tests (single-replace shift, accept-all back-to-front,
   stale finding, overlap).
3. `checker.py` against live `llama-server`/Qwen — validate JSON-only output and
   thinking-strip on one real segment.
4. `router.py` WS endpoint emitting the section 8 events; a canned-finding stub
   so the frontend can be built independently.
5. Frontend: `useSpellCheckWS.ts` → `SpellCheck.tsx` → `FindingCard` / `DocView`.
6. `naming_pass.py` (additive).
7. Per-segment caching once the happy path is solid.

Test-driven throughout (`test-driven-development`).

## 12. Test cases that must pass (handoff §9)

- **Reconstruction:** segments rebuild the original document byte-for-byte.
- **Length-changing replace:** apply `protagnist→protagonist` (grows by 1), then
  apply a later finding — the later one lands on the correct characters.
- **Accept all:** every suggestion applied, final text correct, no off-by-one.
- **Stale finding:** user edits so `slice !== original`; replace does not corrupt
  the document (skips or re-locates per section 7.4).
- **Bad LLM output:** a segment returns non-JSON / fenced JSON / with a reasoning
  block — parser recovers or emits a segment `error` without killing the stream.
- **One segment fails:** remaining segments still stream and render.
- **Cross-segment naming:** "Sarah" (segment 1) vs "Sara" (segment 5) is flagged
  by the naming pass.

## 13. Documentation obligation (handoff §0.2)

Record in `CLAUDE.md`: the segment/chunking model, the `Finding` JSON schema, the
global-offset rule (section 7), and the WS event contract (section 8). These are
the load-bearing invariants. The new WS route is additive — note it; do not
silently change existing contract routes.

## 14. Things NOT to do (handoff §10)

- Don't put the whole document in one LLM call.
- Don't use segment-local offsets anywhere in the frontend.
- Don't re-run all segments after a single edit — cache and re-check only changed.
- Don't abort the whole stream when one segment fails.
- Don't blindly splice without the `slice === original` verify.
- Don't change existing contract routes silently.
