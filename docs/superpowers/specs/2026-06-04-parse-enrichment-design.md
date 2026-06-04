# Parse Enrichment (Sub-project B) — Design

**Date:** 2026-06-04
**Status:** Approved
**Depends on:** existing pipeline parse + scene-refinement (A0) + chat engine (A1/A2)

## 1. Goal & Scope

Enrich the per-chunk scene parse so each parse pass produces, in a single LLM
call:

1. **Emotion-tagged character dialogue** — each spoken line carries a controlled
   emotion + optional intensity, for better character voice expression.
2. **Narration list** — narrator / voice-over prose is detected by the parser
   and separated from character speech. No "Narrator" pseudo-speaker.
3. **Normalized proper nouns** — character and location names are made
   consistent via a per-episode **canonical-entity registry** that the parser
   consults and grows, and that the user can edit.

Plus a **derived character voice-profile view** (emotion aggregation across the
episode — no storage).

No new generation logic. This stays a parse/display layer over the existing
pipeline. Fixing *already-parsed* scenes without a re-parse is **out of scope**
for B (deferred to sub-project C / a later "apply registry" action).

## 2. Data Model Changes

All new fields are optional or defaulted, so existing `*_scenes.json` files load
unchanged (missing fields → `None` / `[]`).

```python
class SceneDialogueModel(BaseModel):
    character: str
    line: str
    emotion: str | None = None     # controlled vocab (see below)
    intensity: str | None = None   # "low" | "medium" | "high"

class SceneModel(BaseModel):
    scene_id: str
    location: str
    characters: list[str]
    shot_type: str
    action: str
    dialogue: list[SceneDialogueModel]
    mood: str
    narration: list[str] = []      # narrator / voice-over prose, parser-detected
```

### Controlled emotion vocabulary

Defined once on the backend and mirrored to the frontend (small, stable
constant; kept in sync by convention with a comment in both files):

```
neutral, happy, sad, angry, fearful, surprised,
tender, mocking, commanding, anxious, determined, disgusted
```

Intensity vocabulary: `low | medium | high` (optional per line).

The parser is instructed to choose `emotion` only from this list and to omit it
(leave null) when unsure rather than inventing a value.

## 3. Entity Registry

### File: `processed/{episode_id}/entities.json`

```json
{
  "episode_id": "ep1",
  "updated_at": "2026-06-04T00:00:00Z",
  "characters": [
    { "canonical": "Đại Càn", "aliases": ["đại cản"] }
  ],
  "locations": [
    { "canonical": "Cao's Palace", "aliases": [] }
  ]
}
```

The format carries `episode_id` so the same shape can be promoted to a global
`processed/_entities.json` in a later sub-project ("per-episode now, global
later").

### Module: `animatory/entity_registry.py` (pure, file-backed, unit-tested)

| Function | Behaviour |
|----------|-----------|
| `load(episode_id) -> EntityRegistry` | Read `entities.json`; empty registry if absent. |
| `save(registry)` | Write atomically; stamps `updated_at` (timestamp passed in / `_now()` injected, never `Date`-style nondeterminism in tests). |
| `known_names() -> {characters: [...], locations: [...]}` | Canonical names (+ aliases) for prompt injection. |
| `normalize_scene(scene) -> scene` | **Deterministic** alias→canonical replacement on **structured fields only**: `location`, `characters[]`, `dialogue[].character`. Case- and diacritic-insensitive match against canonical + aliases. Never edits free prose (`action`, `line`, `narration`). |
| `learn(scenes) -> registry` | Add genuinely-new names (not matching any canonical/alias) as new canonical entries. Idempotent. |

Matching rule for `normalize_scene` / `learn`: compare on a normalized key
(casefold + Unicode NFC + stripped) so `đại cản` matches alias of `Đại Càn`.

## 4. Correction Flow (đại cản → Đại Càn)

1. First parse emits `đại cản`; registry empty → `learn` adds it as a new
   canonical entry.
2. User opens the **Entity panel**, renames canonical to `Đại Càn`; the old form
   `đại cản` is recorded as an alias.
3. Re-parse: prompt is seeded with `known_names()` ("use these exact spellings"),
   **and** `normalize_scene` deterministically rewrites the structured fields —
   so known aliases are fixed even if the LLM ignores the hint. New chunks stay
   consistent.

## 5. Parse Flow (extends existing per-chunk parse)

`parse_chunk` gains registry awareness; temperature (0.2), retry/backoff, and
thinking-strip logic are unchanged:

1. `registry = entity_registry.load(episode_id)`
2. Build prompt: existing schema **+** emotion/intensity fields **+** narration
   instruction **+** `registry.known_names()` ("Known names — always use these
   exact spellings; map variants to them").
3. LLM returns enriched JSON (parsed/validated against the updated models).
4. For each scene: `registry.normalize_scene(scene)`.
5. `registry.learn(scenes)`; `entity_registry.save(registry)`.
6. Write `{chunk_id}_scenes.json` as today.

The parse route signatures are **unchanged**; enrichment is internal. The
`parse_episode` background task threads the registry through (loaded per episode,
saved after each chunk, or once after the run — implementation detail for the
plan; must be safe under the per-chunk loop).

## 6. Voice Profiles (derived, no storage)

`GET /pipeline/episodes/{episode_id}/voice-profiles` aggregates across all chunk
scene files (edited copy preferred, same precedence as elsewhere):

```jsonc
[
  {
    "character": "Đại Càn",
    "line_count": 14,
    "emotions": { "commanding": 8, "angry": 4, "neutral": 2 },
    "dominant_emotion": "commanding",
    "dominant_intensity": "high"
  }
]
```

Pure derivation — always in sync, recomputed on request. Implemented as a pure
aggregation helper over loaded scenes (unit-tested independently of the route).

## 7. Routes

| Method | Route | Body / Response |
|--------|-------|-----------------|
| GET | `/pipeline/episodes/{episode_id}/entities` | registry JSON |
| PUT | `/pipeline/episodes/{episode_id}/entities` | full registry → saved registry (rename canonical, add/merge aliases) |
| GET | `/pipeline/episodes/{episode_id}/voice-profiles` | derived profile list |

Existing parse / scene / chat routes unchanged.

## 8. Frontend

- **`pipeline.ts`**: `SceneDialogue` gains `emotion?` / `intensity?`;
  `PipelineScene` gains `narration: string[]`. New types
  `EntityRegistry`, `EntityEntry`, `VoiceProfile`; new clients
  `getEntities`, `saveEntities`, `getVoiceProfiles`.
- **EditableSceneCard**: per-dialogue-line emotion dropdown (controlled vocab) +
  intensity selector; editable narration list (add/remove lines).
- **SceneList** (read-only): emotion chips on dialogue lines; narration block.
- **EntityRegistryPanel** (new): list characters + locations; edit canonical
  name; add / merge / remove aliases.
- **VoiceProfilePanel** (new): per-character emotion breakdown (counts + dominant).
- **ChapterView**: wire both panels alongside the existing refine chat.

All UI work runs the **`ui-taste`** skill first: one accent `#3772cf`
(hover `#2c5cab`), token-only spacing/radius/color, real loading/empty/error
states, restrained motion, no emoji-as-placeholder.

## 9. Testing

**Backend**
- `entity_registry` units: `normalize_scene` (case/diacritic-insensitive alias
  match on structured fields only; leaves prose untouched), `learn` (adds new,
  idempotent on repeat), `known_names`, load-missing-file → empty,
  save/round-trip.
- Parse with **mocked LLM**: enriched output (emotion/intensity/narration)
  validates against models; `normalize_scene` + `learn` applied; registry grown
  and saved.
- Backward-compat: load an old `*_scenes.json` lacking new fields → defaults.
- Voice-profile aggregation helper: emotion counts, dominant selection, empty
  input, edited-copy precedence.
- Entity routes (GET/PUT) + voice-profiles route.

**Frontend** (Vitest, no DOM lib — pure logic + fetch-mock per project convention)
- `pipeline.ts` clients (`getEntities`/`saveEntities`/`getVoiceProfiles`) via
  fetch-mock.
- Any pure edit/aggregation helpers (e.g. alias merge, emotion option list).

## 10. Out of Scope (explicit)

- Applying the registry to already-parsed scenes **without** a re-parse
  (deferred — sub-project C / later "apply registry" action).
- Global cross-episode registry (format is ready; wiring is later).
- Persisted / LLM-written voice descriptors (profiles stay derived emotion stats).
- Per-line narration emotion (narration is `list[str]` for B).
