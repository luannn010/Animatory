# Transcript Pipeline — Chunk → Parse → Shot List

**Date:** 2026-06-02
**Status:** Approved

---

## Overview

A two-phase pipeline that takes a raw Vietnamese transcript (`.txt`), splits it into overlapping word-bounded chunks, then sends each chunk to a local Qwen3.5 inference server to extract a production-ready shot list. Results are written to a structured folder tree for use in downstream animation phases.

The pipeline is exposed via:
- Two new backend API routes on the existing FastAPI server
- A self-contained upload card component in the frontend (no new page/route)
- Two new Python modules: `animatory/chunker.py` and `animatory/scene_parser.py`

---

## Scope

**In scope:**
- Chunker module + CLI subcommand
- Scene parser module (Qwen3.5 via OpenAI-compatible API)
- Two backend pipeline routes + episode listing route
- Frontend upload card with SSE progress

**Out of scope:**
- Authentication / multi-user
- Cloud storage
- Shot list editing UI
- Downstream animation triggering (that is the "next phase")

---

## Output Folder Structure

```
{ANIMATORY_PROCESSED_DIR}/
  {episode_id}/                  ← derived from uploaded filename stem (e.g. ep1.txt → ep1)
    manifest.json                ← run config + per-chunk metadata (no chunk text)
    C001.txt                     ← raw chunk text
    C001_scenes.json             ← shot list extracted by Qwen
    C002.txt
    C002_scenes.json
    ...
```

`ANIMATORY_PROCESSED_DIR` defaults to a `processed/` directory beside the uploaded file. Configurable via environment variable.

---

## Module 1: `animatory/chunker.py`

### Public API

```python
def chunk_text(
    text: str,
    target_words: int = 4600,
    overlap_words: int = 250,
    min_chunk_words: int = 500,
) -> list[ChunkRecord]:
    ...

def chunk_file(
    source_path: str | Path,
    output_dir: str | Path,
    target_words: int = 4600,
    overlap_words: int = 250,
    min_chunk_words: int = 500,
) -> Path:
    """Chunks source_path, writes chunk files + manifest.json into output_dir.
    Returns the path to manifest.json."""
```

### ChunkRecord (internal dataclass)

```python
@dataclass
class ChunkRecord:
    chunk_id: str        # "C001", "C002", ...
    word_start: int
    word_end: int
    char_start: int
    char_end: int
    word_count: int
    overlap_prev_words: int
    text: str            # NOT written to manifest; written to C0NN.txt
```

### Algorithm

1. Split text on whitespace into `words[]`; build a parallel `char_offsets[]` array mapping word index → character start position in the original string.
2. Starting from cursor `pos = 0` (word index):
   - Accumulate words until count reaches `target_words`.
   - Scan forward from that position for the next sentence boundary: `.`, `?`, or `!` followed by whitespace or end-of-text. Extend chunk to include that boundary word.
   - If no boundary is found before end-of-text, take all remaining words (emit warning if chunk exceeds `target_words + 500`).
   - Record `char_start = char_offsets[word_start]`. `char_end` is the exclusive end index such that `text[char_start:char_end]` equals the chunk text exactly. Compute as `char_offsets[word_end - 1] + len(words[word_end - 1])` where `word_end` is the exclusive word boundary.
   - Advance cursor: `pos = word_end - overlap_words`, clamped so it never goes before the previous chunk's `word_start + 1`.
3. If the final segment is shorter than `min_chunk_words`, merge it into the previous chunk (extend `char_end`, recalculate counts).
4. Chunk IDs are zero-padded to match total count width (e.g. `C001` for up to 999 chunks).

### Invariant (critical)

```
original_text[chunk.char_start : chunk.char_end] == contents_of(C0NN.txt)
```

This must hold for every chunk. All downstream deduplication depends on it.

### manifest.json shape

```json
{
  "source_file": "ep1.txt",
  "total_words": 88919,
  "total_chars": 500000,
  "config": {
    "target_words": 4600,
    "overlap_words": 250,
    "min_chunk_words": 500
  },
  "chunk_count": 20,
  "chunks": [
    {
      "chunk_id": "C001",
      "file": "C001.txt",
      "word_start": 0,
      "word_end": 4631,
      "char_start": 0,
      "char_end": 24890,
      "word_count": 4631,
      "overlap_prev_words": 0
    }
  ]
}
```

### stdout summary

```
Chunked ep1.txt → 20 chunks
  Min: 4502 words   Avg: 4618 words   Max: 4891 words
  WARNING: C014 exceeds target by 612 words (no sentence boundary found)
```

### Edge cases

| Case | Behaviour |
|------|-----------|
| Empty input | Write manifest with `chunk_count: 0`, no `.txt` files |
| Input < one chunk | Single chunk containing all text |
| No sentence boundary in a run | Allow overrun, print warning |
| UTF-8 diacritics | All string operations on `str` (Python 3 unicode); files written with `encoding="utf-8"` |

### Self-test

A `--self-test` flag on the CLI subcommand runs three assertions against the first 15,000 words of the input before processing the full file:

1. `original[char_start:char_end] == open(file).read()` for every chunk
2. Consecutive chunks share approximately `overlap_words` words (±10%)
3. No chunk (except warned ones) ends mid-sentence

Results printed to stdout; exits non-zero on failure.

---

## Module 2: `animatory/scene_parser.py`

### Public API

```python
async def parse_chunk(
    chunk_id: str,
    chunk_text: str,
    episode_id: str,
    output_dir: Path,
    qwen_endpoint: str = "http://localhost:1090",
    model: str = "qwen3.5",
) -> Path:
    """Calls Qwen, writes C0NN_scenes.json, returns its path."""
```

### Qwen integration

- Endpoint: `POST {qwen_endpoint}/v1/chat/completions` (OpenAI-compatible)
- Uses `httpx.AsyncClient` — same pattern as `animatory/executors/llamacpp.py`
- Single user message containing the chunk text + structured prompt
- Response expected as raw JSON matching the scene schema (no prose wrapper)
- Retry: up to 3 attempts with exponential backoff on HTTP errors or JSON parse failures

### Prompt template

```
You are a Vietnamese novel-to-animation production assistant.
Extract a complete shot list from the following chapter text.
Return ONLY valid JSON matching this schema — no explanation, no markdown:

{
  "chunk_id": "<id>",
  "scenes": [
    {
      "scene_id": "<chunk_id>_S01",
      "location": "string",
      "characters": ["string"],
      "shot_type": "wide | medium | close-up | insert | POV",
      "action": "string",
      "dialogue": [{"character": "string", "line": "string"}],
      "mood": "string"
    }
  ]
}

Chapter text:
---
{chunk_text}
---
```

### `C0NN_scenes.json` shape

```json
{
  "chunk_id": "C001",
  "source_file": "ep1.txt",
  "char_start": 0,
  "char_end": 24890,
  "model": "qwen3.5",
  "parsed_at": "2026-06-02T10:00:00Z",
  "scenes": [
    {
      "scene_id": "C001_S01",
      "location": "Princess Cao Duong's chamber",
      "characters": ["Tu An", "Tieu Lan Nhi"],
      "shot_type": "medium",
      "action": "Tu An lies bound to the bed while the princess holds scissors threateningly",
      "dialogue": [
        {"character": "Tu An", "line": "Mẹ kiếp, mỹ nhân cô nhận nhầm người rồi..."}
      ],
      "mood": "tense, darkly comedic"
    }
  ]
}
```

---

## Backend: New API Routes

Added to `animatory/server.py`. The two new pipeline routes sit alongside existing agent routes.

### `POST /pipeline/chunk`

- **Request:** `multipart/form-data` with field `file` (the `.txt` upload) and optional `episode_id` (defaults to filename stem)
- **Response:** `{ "episode_id": "ep1", "chunk_count": 20, "output_dir": "..." }`
- **Behaviour:** Synchronous. Runs `chunk_file()`, returns immediately with manifest summary.

### `POST /pipeline/parse/{episode_id}`

- **Request body:** `{ "chunk_ids": ["C001", "C002"] }` — optional; omit to parse all chunks
- **Response:** `{ "run_id": "..." }` — reuses existing `RunStore` + SSE stream infrastructure
- **Behaviour:** Async. Each chunk is parsed sequentially (to avoid overloading Qwen). Progress emitted as SSE log events via existing `/runs/{run_id}/stream`.

### `GET /pipeline/episodes`

- **Response:** list of episode objects found under `ANIMATORY_PROCESSED_DIR`

```json
[
  {
    "episode_id": "ep1",
    "chunk_count": 20,
    "parsed_count": 12,
    "status": "partial"
  }
]
```

Status values: `"chunked"` (manifest exists, no scene files yet), `"partial"` (some parsed), `"complete"` (all chunks have `_scenes.json`).

---

## CLI Subcommand: `animatory chunk`

Added to existing `animatory/cli.py` argparse setup.

```bash
# Chunk only
python -m animatory.cli chunk D:\Animatory\Animatorymockup\test.txt \
  --output-dir D:\Animatory\Animatorymockup\processed

# Chunk + parse in one step
python -m animatory.cli chunk D:\Animatory\Animatorymockup\test.txt \
  --output-dir D:\Animatory\Animatorymockup\processed \
  --parse \
  --qwen-endpoint http://localhost:1090

# Self-test before processing
python -m animatory.cli chunk ep1.txt --output-dir processed --self-test
```

---

## Frontend: Upload Card Component

A self-contained `UploadTranscript` component added to the existing home/dashboard page (no new route).

### Layout

```
┌─────────────────────────────────────────┐
│  Upload Transcript                       │
│                                          │
│  [ Drop .txt file or click to browse ]  │
│                                          │
│  Episode name: [ep1          ]           │
│                                          │
│  [ Process Transcript ]                  │
│                                          │
│  ── Progress ──────────────────────────  │
│  ✓ Chunked: 20 chunks                   │
│  ⟳ Parsing C007 / 20...                 │
└─────────────────────────────────────────┘
```

### Behaviour

1. User drops or selects a `.txt` file → episode name auto-fills from filename stem
2. "Process Transcript" → `POST /pipeline/chunk` (multipart) → on success, immediately calls `POST /pipeline/parse/{episode_id}`
3. SSE stream from `/runs/{run_id}/stream` drives the progress log — reuses existing `useRunStream` hook
4. On completion, a "View Results" link appears pointing to the episode's folder listing (future phase)

### Files

- `frontend/src/components/UploadTranscript.tsx` — the card component
- `frontend/src/api/index.ts` — two new API calls: `chunkTranscript()`, `parseEpisode()`

---

## Configuration (new env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `ANIMATORY_PROCESSED_DIR` | `./processed` | Root output directory for all episodes |
| `QWEN_ENDPOINT` | `http://localhost:1090` | Qwen3.5 inference server base URL |
| `QWEN_MODEL` | `qwen3.5` | Model name passed in chat completion requests |
| `QWEN_MAX_RETRIES` | `3` | Retries on Qwen parse/HTTP failure |

---

## Testing

- `tests/test_chunker.py` — unit tests for `chunk_text()`: offset invariant, overlap correctness, edge cases (empty, single chunk, no boundary)
- `tests/test_scene_parser.py` — unit tests with mocked `httpx` responses; verifies JSON schema, retry logic
- `tests/test_pipeline_api.py` — integration tests for `/pipeline/chunk` and `/pipeline/parse/{episode_id}` using `TestClient` and a small fixture `.txt`

All tests run without a live Qwen server (mocked). The `--self-test` CLI flag covers the live invariant check.

---

## Definition of Done

- [ ] `chunk_text()` passes all three self-test assertions on `test.txt`
- [ ] `chunk_file()` writes correct `manifest.json` and `.txt` files under `ep1/`
- [ ] `animatory chunk test.txt --output-dir processed` runs end-to-end
- [ ] `POST /pipeline/chunk` returns manifest summary
- [ ] `POST /pipeline/parse/ep1` returns `run_id`, streams progress via SSE
- [ ] Each `C0NN_scenes.json` satisfies the shot list schema
- [ ] `UploadTranscript` component uploads, chunks, parses, and streams progress
- [ ] All new tests pass: `pytest tests/test_chunker.py tests/test_scene_parser.py tests/test_pipeline_api.py -v`
