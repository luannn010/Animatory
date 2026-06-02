# Transcript Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-phase Vietnamese transcript pipeline — chunker module + CLI, Qwen3.5 scene parser, three FastAPI pipeline routes, and a frontend upload card wired to SSE progress.

**Architecture:** `animatory/chunker.py` (pure, no I/O side effects) + `animatory/scene_parser.py` (async httpx to Qwen) are new modules; `animatory/server.py` gains a `/pipeline` router; `animatory/cli.py` gains a `chunk` subcommand; the frontend `ParseView` gains a real upload card that drives the full pipeline.

**Tech Stack:** Python 3.11, FastAPI, httpx, pytest-asyncio; React 18, TypeScript, Tailwind CSS.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `animatory/chunker.py` | Create | `chunk_text()` + `chunk_file()` — pure splitting logic, writes `.txt` + `manifest.json` |
| `animatory/scene_parser.py` | Create | `parse_chunk()` — calls Qwen, writes `_scenes.json` |
| `animatory/pipeline_router.py` | Create | FastAPI router with `/pipeline/chunk`, `/pipeline/parse/{episode_id}`, `/pipeline/episodes` |
| `animatory/cli.py` | Modify | Add `chunk` subcommand (lines 92–116) |
| `animatory/server.py` | Modify | `app.include_router(pipeline_router)` + env var wiring |
| `tests/test_chunker.py` | Create | Unit tests for `chunk_text()` |
| `tests/test_scene_parser.py` | Create | Unit tests for `parse_chunk()` with mocked httpx |
| `tests/test_pipeline_api.py` | Create | Integration tests for pipeline routes |
| `frontend/src/api/pipeline.ts` | Create | `chunkTranscript()`, `parseEpisode()`, `listEpisodes()` API calls |
| `frontend/src/components/UploadTranscript.tsx` | Create | File drop + episode name + SSE progress card |
| `frontend/src/studio/views/ParseView.tsx` | Modify | Import and render `<UploadTranscript />` below existing file list |

---

## Task 1: `animatory/chunker.py` — core algorithm

**Files:**
- Create: `animatory/chunker.py`
- Create: `tests/test_chunker.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_chunker.py
from __future__ import annotations
import pytest
from animatory.chunker import chunk_text, chunk_file, ChunkRecord
from pathlib import Path
import json, tempfile, os

TINY = "word " * 10  # 10 words, no sentence boundary

SAMPLE = (
    "Mẹ kiếp, mỹ nhân cô nhận nhầm người rồi. " * 120   # ~600 words, sentence boundaries every ~8 words
)

def test_chunk_text_returns_list():
    records = chunk_text(SAMPLE, target_words=50, overlap_words=5, min_chunk_words=10)
    assert isinstance(records, list)
    assert len(records) >= 1

def test_chunk_record_fields():
    records = chunk_text(SAMPLE, target_words=50, overlap_words=5, min_chunk_words=10)
    r = records[0]
    assert r.chunk_id == "C001"
    assert r.char_start == 0
    assert r.char_end > 0
    assert r.word_count > 0
    assert r.overlap_prev_words == 0

def test_offset_invariant():
    """original[char_start:char_end] must equal chunk text exactly."""
    records = chunk_text(SAMPLE, target_words=50, overlap_words=5, min_chunk_words=10)
    for r in records:
        assert SAMPLE[r.char_start:r.char_end] == r.text, (
            f"{r.chunk_id}: offset mismatch"
        )

def test_overlap_between_consecutive_chunks():
    records = chunk_text(SAMPLE, target_words=50, overlap_words=5, min_chunk_words=10)
    if len(records) < 2:
        pytest.skip("need 2+ chunks")
    for i in range(1, len(records)):
        assert records[i].overlap_prev_words >= 0
        # overlap should be approximately overlap_words (allow ±50%)
        assert records[i].overlap_prev_words <= 5 * 2

def test_empty_input():
    records = chunk_text("", target_words=100, overlap_words=10, min_chunk_words=5)
    assert records == []

def test_single_chunk_when_short():
    short = "Hello world this is a test sentence. " * 3
    records = chunk_text(short, target_words=500, overlap_words=10, min_chunk_words=5)
    assert len(records) == 1
    assert records[0].char_start == 0
    assert records[0].char_end == len(short.rstrip())

def test_min_chunk_merges_tail():
    # Create text where last segment would be tiny
    # 110 words: target=100, overlap=5, min=20 → tail is 10 words → should merge
    text = " ".join(f"word{i}." for i in range(110))
    records = chunk_text(text, target_words=100, overlap_words=5, min_chunk_words=20)
    # Tail (10 words) < min_chunk_words (20) → merged into previous
    # So only 1 chunk total (since 110 words is close to one target)
    assert all(r.word_count >= 20 or len(records) == 1 for r in records)

def test_chunk_ids_zero_padded():
    # Generate enough chunks to need 2-digit IDs
    big = ("sentence boundary here. " * 5 + " ") * 50  # ~1250 words
    records = chunk_text(big, target_words=50, overlap_words=5, min_chunk_words=10)
    if len(records) >= 10:
        assert records[9].chunk_id == "C010"

def test_chunk_file_writes_files(tmp_path):
    src = tmp_path / "ep1.txt"
    src.write_text(SAMPLE, encoding="utf-8")
    manifest_path = chunk_file(src, tmp_path / "out", target_words=50, overlap_words=5, min_chunk_words=10)
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["source_file"] == "ep1.txt"
    assert manifest["chunk_count"] >= 1
    # Verify each chunk file exists and offset invariant holds
    original = src.read_text(encoding="utf-8")
    for chunk_meta in manifest["chunks"]:
        chunk_file_path = manifest_path.parent / chunk_meta["file"]
        assert chunk_file_path.exists()
        assert original[chunk_meta["char_start"]:chunk_meta["char_end"]] == chunk_file_path.read_text(encoding="utf-8")
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_chunker.py -v
```

Expected: `ImportError: cannot import name 'chunk_text' from 'animatory.chunker'` (module doesn't exist yet).

- [ ] **Step 3: Implement `animatory/chunker.py`**

```python
# animatory/chunker.py
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ChunkRecord:
    chunk_id: str
    word_start: int
    word_end: int      # exclusive
    char_start: int
    char_end: int      # exclusive: text[char_start:char_end] == self.text
    word_count: int
    overlap_prev_words: int
    text: str


def _build_word_offsets(text: str) -> tuple[list[str], list[int]]:
    """Return (words, char_offsets) where char_offsets[i] is the start of words[i] in text."""
    words: list[str] = []
    offsets: list[int] = []
    for m in re.finditer(r'\S+', text):
        words.append(m.group())
        offsets.append(m.start())
    return words, offsets


def _ends_sentence(word: str) -> bool:
    return bool(re.search(r'[.?!]$', word))


def chunk_text(
    text: str,
    target_words: int = 4600,
    overlap_words: int = 250,
    min_chunk_words: int = 500,
) -> list[ChunkRecord]:
    if not text.strip():
        return []

    words, offsets = _build_word_offsets(text)
    n = len(words)
    records: list[ChunkRecord] = []
    pos = 0  # word index cursor
    warned: set[int] = set()

    while pos < n:
        # Accumulate target_words
        end = min(pos + target_words, n)

        # Extend to next sentence boundary at or after end
        if end < n:
            boundary = end
            while boundary < n and not _ends_sentence(words[boundary - 1]):
                boundary += 1
            if boundary > end and (boundary - pos) > target_words + 500:
                warned.add(len(records))
            end = boundary  # may equal n if no boundary found

        # char_end: exclusive index right after the last character of words[end-1]
        char_start = offsets[pos]
        char_end = offsets[end - 1] + len(words[end - 1])
        chunk_text_str = text[char_start:char_end]

        prev_start = records[-1].word_start if records else pos
        overlap = records[-1].word_end - pos if records else 0
        overlap = max(overlap, 0)

        records.append(ChunkRecord(
            chunk_id="",           # filled in after merge pass
            word_start=pos,
            word_end=end,
            char_start=char_start,
            char_end=char_end,
            word_count=end - pos,
            overlap_prev_words=overlap,
            text=chunk_text_str,
        ))

        # Advance cursor with overlap rewind
        next_pos = end - overlap_words
        next_pos = max(next_pos, pos + 1)  # never go backward
        pos = next_pos

    # Merge tiny tail
    if len(records) >= 2 and records[-1].word_count < min_chunk_words:
        tail = records.pop()
        prev = records[-1]
        records[-1] = ChunkRecord(
            chunk_id="",
            word_start=prev.word_start,
            word_end=tail.word_end,
            char_start=prev.char_start,
            char_end=tail.char_end,
            word_count=prev.word_count + tail.word_count - tail.overlap_prev_words,
            overlap_prev_words=prev.overlap_prev_words,
            text=text[prev.char_start:tail.char_end],
        )

    # Assign zero-padded IDs
    width = max(3, len(str(len(records))))
    fmt = f"C{{:0{width}d}}"
    for i, r in enumerate(records):
        r.chunk_id = fmt.format(i + 1)

    # Print summary
    if records:
        counts = [r.word_count for r in records]
        print(
            f"Chunked → {len(records)} chunks  "
            f"Min: {min(counts)}  Avg: {sum(counts)//len(counts)}  Max: {max(counts)}"
        )
        for i in warned:
            if i < len(records):
                excess = records[i].word_count - target_words
                print(f"  WARNING: {records[i].chunk_id} exceeds target by {excess} words (no sentence boundary found)", file=sys.stderr)

    return records


def chunk_file(
    source_path: str | Path,
    output_dir: str | Path,
    target_words: int = 4600,
    overlap_words: int = 250,
    min_chunk_words: int = 500,
) -> Path:
    """Chunk source_path, write .txt files + manifest.json into output_dir.
    Returns path to manifest.json."""
    source_path = Path(source_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    text = source_path.read_text(encoding="utf-8")
    records = chunk_text(text, target_words=target_words, overlap_words=overlap_words, min_chunk_words=min_chunk_words)

    for r in records:
        (output_dir / f"{r.chunk_id}.txt").write_text(r.text, encoding="utf-8")

    manifest = {
        "source_file": source_path.name,
        "total_words": sum(len(w.split()) for w in [text]),
        "total_chars": len(text),
        "config": {
            "target_words": target_words,
            "overlap_words": overlap_words,
            "min_chunk_words": min_chunk_words,
        },
        "chunk_count": len(records),
        "chunks": [
            {
                "chunk_id": r.chunk_id,
                "file": f"{r.chunk_id}.txt",
                "word_start": r.word_start,
                "word_end": r.word_end,
                "char_start": r.char_start,
                "char_end": r.char_end,
                "word_count": r.word_count,
                "overlap_prev_words": r.overlap_prev_words,
            }
            for r in records
        ],
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path
```

- [ ] **Step 4: Run tests — all should pass**

```
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_chunker.py -v
```

Expected: all green. Fix any assertion failures before continuing.

- [ ] **Step 5: Commit**

```bash
git add animatory/chunker.py tests/test_chunker.py
git commit -m "feat(chunker): add chunk_text and chunk_file with offset invariant"
```

---

## Task 2: CLI `chunk` subcommand

**Files:**
- Modify: `animatory/cli.py` (lines 92–116)

- [ ] **Step 1: Add imports and `cmd_chunk` to `animatory/cli.py`**

At the top of `cli.py`, after the existing imports (line 17), add:

```python
from animatory.chunker import chunk_file
```

After `cmd_list` (before `main`, around line 91) add:

```python
def cmd_chunk(args: argparse.Namespace) -> None:
    source = pathlib.Path(args.source)
    if not source.exists():
        print(f"Error: file not found: {source}", file=sys.stderr)
        sys.exit(1)

    output_dir = pathlib.Path(args.output_dir) / source.stem
    manifest_path = chunk_file(
        source,
        output_dir,
        target_words=args.target_words,
        overlap_words=args.overlap_words,
        min_chunk_words=args.min_chunk_words,
    )
    print(f"Manifest: {manifest_path}")

    if args.self_test:
        import json as _json
        text = source.read_text(encoding="utf-8")
        manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
        errors = []
        for c in manifest["chunks"]:
            chunk_path = manifest_path.parent / c["file"]
            got = chunk_path.read_text(encoding="utf-8")
            expected = text[c["char_start"]:c["char_end"]]
            if got != expected:
                errors.append(f"{c['chunk_id']}: offset mismatch")
        if errors:
            print("SELF-TEST FAILED:", file=sys.stderr)
            for e in errors:
                print(f"  {e}", file=sys.stderr)
            sys.exit(1)
        else:
            print("Self-test PASSED: all offsets valid.")

    if args.parse:
        import asyncio as _asyncio
        from animatory.scene_parser import parse_episode
        _asyncio.run(parse_episode(
            source.stem,
            manifest_path.parent,
            qwen_endpoint=args.qwen_endpoint,
        ))
```

- [ ] **Step 2: Register the subcommand in `main()`**

Replace the `main()` function body (lines 92–116) with:

```python
def main() -> None:
    parser = argparse.ArgumentParser(prog="animatory.cli", description="Animatory CLI")
    sub = parser.add_subparsers(dest="command")

    run_p = sub.add_parser("run", help="Run an agent")
    run_p.add_argument("agent_id")
    run_p.add_argument("--context", metavar="<json_file>", default=None)
    run_p.add_argument("--system-prompt", metavar="<text>", default=None)
    run_p.add_argument("--fake", action="store_true", help="Use FakeExecutor")

    sub.add_parser("list", help="List all agents")

    chunk_p = sub.add_parser("chunk", help="Chunk a transcript file")
    chunk_p.add_argument("source", metavar="<txt_file>")
    chunk_p.add_argument("--output-dir", default="processed", metavar="<dir>")
    chunk_p.add_argument("--target-words", type=int, default=4600)
    chunk_p.add_argument("--overlap-words", type=int, default=250)
    chunk_p.add_argument("--min-chunk-words", type=int, default=500)
    chunk_p.add_argument("--self-test", action="store_true")
    chunk_p.add_argument("--parse", action="store_true", help="Also run scene parser after chunking")
    chunk_p.add_argument("--qwen-endpoint", default="http://localhost:1090")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(cmd_run(args))
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "chunk":
        cmd_chunk(args)
    else:
        parser.print_help()
        sys.exit(1)
```

- [ ] **Step 3: Smoke-test the CLI**

```
cd d:\Animatory
python -m animatory.cli chunk "D:\Animatory\Animatorymockup\test.txt" --output-dir "D:\Animatory\Animatorymockup\processed" --self-test
```

Expected output (numbers will differ):
```
Chunked → N chunks  Min: XXXX  Avg: XXXX  Max: XXXX
Manifest: D:\Animatory\Animatorymockup\processed\test\manifest.json
Self-test PASSED: all offsets valid.
```

- [ ] **Step 4: Commit**

```bash
git add animatory/cli.py
git commit -m "feat(cli): add chunk subcommand with --self-test and --parse flags"
```

---

## Task 3: `animatory/scene_parser.py`

**Files:**
- Create: `animatory/scene_parser.py`
- Create: `tests/test_scene_parser.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_scene_parser.py
from __future__ import annotations
import json, pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from animatory.scene_parser import parse_chunk, parse_episode

FAKE_SCENES_RESPONSE = {
    "chunk_id": "C001",
    "scenes": [
        {
            "scene_id": "C001_S01",
            "location": "Palace chamber",
            "characters": ["Tu An", "Princess"],
            "shot_type": "medium",
            "action": "Tu An lies bound to the bed",
            "dialogue": [{"character": "Tu An", "line": "Mẹ kiếp!"}],
            "mood": "tense",
        }
    ],
}

def _make_mock_response(content: str, status: int = 200):
    mock_resp = MagicMock()
    mock_resp.status_code = status
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": content}}]
    }
    return mock_resp


@pytest.mark.asyncio
async def test_parse_chunk_writes_json(tmp_path):
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(FAKE_SCENES_RESPONSE)))
        MockClient.return_value = instance

        out = await parse_chunk(
            chunk_id="C001",
            chunk_text="Mẹ kiếp, test text.",
            episode_id="ep1",
            output_dir=tmp_path,
        )

    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["chunk_id"] == "C001"
    assert len(data["scenes"]) == 1
    assert data["scenes"][0]["scene_id"] == "C001_S01"


@pytest.mark.asyncio
async def test_parse_chunk_retries_on_bad_json(tmp_path):
    bad = "not json at all"
    good = json.dumps(FAKE_SCENES_RESPONSE)
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            return _make_mock_response(bad)
        return _make_mock_response(good)

    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=side_effect)
        MockClient.return_value = instance

        out = await parse_chunk("C001", "text", "ep1", tmp_path, max_retries=3)

    assert call_count == 3
    assert out.exists()


@pytest.mark.asyncio
async def test_parse_chunk_fails_after_max_retries(tmp_path):
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response("not json"))
        MockClient.return_value = instance

        with pytest.raises(ValueError, match="Failed to parse JSON"):
            await parse_chunk("C001", "text", "ep1", tmp_path, max_retries=2)


@pytest.mark.asyncio
async def test_parse_episode_processes_all_chunks(tmp_path):
    # Set up a minimal episode directory with manifest + two chunks
    ep_dir = tmp_path / "ep1"
    ep_dir.mkdir()
    (ep_dir / "C001.txt").write_text("chunk one text.", encoding="utf-8")
    (ep_dir / "C002.txt").write_text("chunk two text.", encoding="utf-8")
    manifest = {
        "source_file": "ep1.txt",
        "chunk_count": 2,
        "chunks": [
            {"chunk_id": "C001", "file": "C001.txt", "char_start": 0, "char_end": 15},
            {"chunk_id": "C002", "file": "C002.txt", "char_start": 16, "char_end": 31},
        ],
    }
    (ep_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with patch("animatory.scene_parser.parse_chunk", new_callable=AsyncMock) as mock_pc:
        mock_pc.return_value = ep_dir / "C001_scenes.json"
        await parse_episode("ep1", ep_dir)

    assert mock_pc.call_count == 2
```

- [ ] **Step 2: Run tests to confirm they fail**

```
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_parser.py -v
```

Expected: `ImportError: cannot import name 'parse_chunk'`

- [ ] **Step 3: Implement `animatory/scene_parser.py`**

```python
# animatory/scene_parser.py
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)

_PROMPT_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Extract a complete shot list from the following chapter text.
Return ONLY valid JSON matching this schema — no explanation, no markdown:

{{
  "chunk_id": "{chunk_id}",
  "scenes": [
    {{
      "scene_id": "{chunk_id}_S01",
      "location": "string",
      "characters": ["string"],
      "shot_type": "wide | medium | close-up | insert | POV",
      "action": "string",
      "dialogue": [{{"character": "string", "line": "string"}}],
      "mood": "string"
    }}
  ]
}}

Chapter text:
---
{chunk_text}
---"""


async def parse_chunk(
    chunk_id: str,
    chunk_text: str,
    episode_id: str,
    output_dir: Path,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> Path:
    """Call Qwen, write {chunk_id}_scenes.json into output_dir, return its path."""
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))

    prompt = _PROMPT_TEMPLATE.format(chunk_id=chunk_id, chunk_text=chunk_text)
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }

    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        if attempt > 1:
            await asyncio.sleep(2 ** (attempt - 1))
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(f"{endpoint}/v1/chat/completions", json=payload)
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                cleaned = _THINKING_RE.sub("", raw).strip()
                # Strip markdown fences if present
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                scenes_data = json.loads(cleaned)
                break
        except (json.JSONDecodeError, KeyError, httpx.HTTPError) as exc:
            logger.warning("%s attempt %d/%d failed: %s", chunk_id, attempt, retries, exc)
            last_exc = exc
    else:
        raise ValueError(f"Failed to parse JSON from Qwen for {chunk_id} after {retries} attempts") from last_exc

    out_path = output_dir / f"{chunk_id}_scenes.json"
    result = {
        "chunk_id": chunk_id,
        "source_file": episode_id + ".txt",
        "model": model_name,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "scenes": scenes_data.get("scenes", []),
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Wrote %s (%d scenes)", out_path, len(result["scenes"]))
    return out_path


async def parse_episode(
    episode_id: str,
    episode_dir: Path,
    chunk_ids: list[str] | None = None,
    qwen_endpoint: str | None = None,
) -> list[Path]:
    """Parse all (or selected) chunks in episode_dir. Returns list of written paths."""
    manifest_path = episode_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    chunks_to_parse = [
        c for c in manifest["chunks"]
        if chunk_ids is None or c["chunk_id"] in chunk_ids
    ]

    results = []
    for c in chunks_to_parse:
        txt_path = episode_dir / c["file"]
        chunk_text = txt_path.read_text(encoding="utf-8")
        path = await parse_chunk(
            chunk_id=c["chunk_id"],
            chunk_text=chunk_text,
            episode_id=episode_id,
            output_dir=episode_dir,
            qwen_endpoint=qwen_endpoint,
        )
        results.append(path)

    return results
```

- [ ] **Step 4: Run tests — all should pass**

```
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_parser.py -v
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_parser.py tests/test_scene_parser.py
git commit -m "feat(scene-parser): add parse_chunk and parse_episode with Qwen integration"
```

---

## Task 4: `animatory/pipeline_router.py` — FastAPI routes

**Files:**
- Create: `animatory/pipeline_router.py`
- Create: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_pipeline_api.py
from __future__ import annotations
import io, json
import pytest
from httpx import AsyncClient

TINY_TXT = b"Sentence one. Sentence two. " * 30  # ~180 words


@pytest.mark.asyncio
async def test_chunk_endpoint_returns_manifest(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("myep.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post("/pipeline/chunk", files=files)
    assert r.status_code == 200
    data = r.json()
    assert data["episode_id"] == "myep"
    assert data["chunk_count"] >= 1
    assert "output_dir" in data


@pytest.mark.asyncio
async def test_chunk_endpoint_custom_episode_id(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("transcript.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post("/pipeline/chunk?episode_id=ep99", files=files)
    assert r.status_code == 200
    assert r.json()["episode_id"] == "ep99"


@pytest.mark.asyncio
async def test_chunk_empty_file(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
    r = await client.post("/pipeline/chunk", files=files)
    assert r.status_code == 200
    assert r.json()["chunk_count"] == 0


@pytest.mark.asyncio
async def test_parse_endpoint_returns_run_id(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    # First chunk it
    files = {"file": ("ep1.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk", files=files)

    # Then parse — mock parse_episode so Qwen not needed
    from unittest.mock import patch, AsyncMock
    with patch("animatory.pipeline_router.parse_episode", new_callable=AsyncMock) as mock_pe:
        mock_pe.return_value = []
        r = await client.post("/pipeline/parse/ep1")
    assert r.status_code == 200
    assert "run_id" in r.json()


@pytest.mark.asyncio
async def test_parse_missing_episode_404(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.post("/pipeline/parse/nonexistent_ep")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_episodes(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": ("ep2.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post("/pipeline/chunk", files=files)
    r = await client.get("/pipeline/episodes")
    assert r.status_code == 200
    episodes = r.json()
    ids = [e["episode_id"] for e in episodes]
    assert "ep2" in ids
```

- [ ] **Step 2: Run tests to confirm they fail**

```
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py -v
```

Expected: `404 Not Found` for all `/pipeline/` routes (router not registered yet).

- [ ] **Step 3: Implement `animatory/pipeline_router.py`**

```python
# animatory/pipeline_router.py
from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from animatory.chunker import chunk_file
from animatory.models import RunRecord, RunStatusEnum
from animatory.scene_parser import parse_episode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


def _processed_dir() -> Path:
    p = Path(os.environ.get("ANIMATORY_PROCESSED_DIR", "processed"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def _episode_status(ep_dir: Path) -> dict:
    manifest_path = ep_dir / "manifest.json"
    if not manifest_path.exists():
        return {"episode_id": ep_dir.name, "chunk_count": 0, "parsed_count": 0, "status": "empty"}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    chunk_count = manifest.get("chunk_count", 0)
    parsed_count = sum(
        1 for c in manifest.get("chunks", [])
        if (ep_dir / f"{c['chunk_id']}_scenes.json").exists()
    )
    if parsed_count == 0:
        status = "chunked"
    elif parsed_count < chunk_count:
        status = "partial"
    else:
        status = "complete"
    return {
        "episode_id": ep_dir.name,
        "chunk_count": chunk_count,
        "parsed_count": parsed_count,
        "status": status,
    }


@router.post("/chunk")
async def chunk_transcript(
    file: UploadFile = File(...),
    episode_id: str | None = Query(default=None),
):
    contents = await file.read()
    ep_id = episode_id or Path(file.filename or "episode").stem
    ep_dir = _processed_dir() / ep_id
    ep_dir.mkdir(parents=True, exist_ok=True)

    source_path = ep_dir / (file.filename or f"{ep_id}.txt")
    source_path.write_bytes(contents)

    manifest_path = chunk_file(source_path, ep_dir)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    return {
        "episode_id": ep_id,
        "chunk_count": manifest["chunk_count"],
        "output_dir": str(ep_dir),
    }


class ParseRequest(BaseModel):
    chunk_ids: list[str] | None = None


@router.post("/parse/{episode_id}")
async def parse_transcript(episode_id: str, request: Request, body: ParseRequest = ParseRequest()):
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")

    # Get store from app state — avoids circular import with server.py
    store = request.app.state.store

    run_id = str(uuid.uuid4())
    record = RunRecord(
        run_id=run_id,
        agent_id=f"pipeline.parse.{episode_id}",
        status=RunStatusEnum.queued,
        started_at=datetime.datetime.utcnow(),
    )
    await store.create(record)

    async def _run():
        await store.update(run_id, status=RunStatusEnum.running)
        try:
            paths = await parse_episode(
                episode_id,
                ep_dir,
                chunk_ids=body.chunk_ids,
            )
            logs = [f"Parsed {p.name}" for p in paths]
            await store.update(
                run_id,
                status=RunStatusEnum.done,
                finished_at=datetime.datetime.utcnow(),
                logs=logs,
            )
        except Exception as exc:
            logger.exception("parse_episode failed: %s", exc)
            await store.update(
                run_id,
                status=RunStatusEnum.failed,
                finished_at=datetime.datetime.utcnow(),
                error=str(exc),
            )

    asyncio.create_task(_run())
    return {"run_id": run_id}


@router.get("/episodes")
async def list_episodes():
    base = _processed_dir()
    return [
        _episode_status(d)
        for d in sorted(base.iterdir())
        if d.is_dir()
    ]
```

- [ ] **Step 4: Wire router into `animatory/server.py`**

After the existing `app.include_router(studio_router)` line (line 77), add:

```python
from animatory.pipeline_router import router as pipeline_router
app.include_router(pipeline_router)
```

- [ ] **Step 5: Run tests**

```
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py -v
```

Expected: all green. The `test_parse_endpoint_returns_run_id` test patches `parse_episode` so no Qwen is needed.

- [ ] **Step 6: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py animatory/server.py
git commit -m "feat(pipeline): add /pipeline/chunk, /pipeline/parse, /pipeline/episodes routes"
```

---

## Task 5: Frontend — API client additions

**Files:**
- Create: `frontend/src/api/pipeline.ts`

- [ ] **Step 1: Create `frontend/src/api/pipeline.ts`**

```typescript
// frontend/src/api/pipeline.ts
import { API_BASE_URL } from '../config'

export interface ChunkResult {
  episode_id: string
  chunk_count: number
  output_dir: string
}

export interface ParseResult {
  run_id: string
}

export interface EpisodeStatus {
  episode_id: string
  chunk_count: number
  parsed_count: number
  status: 'chunked' | 'partial' | 'complete' | 'empty'
}

export async function chunkTranscript(
  file: File,
  episodeId?: string,
): Promise<ChunkResult> {
  const form = new FormData()
  form.append('file', file)
  const url = episodeId
    ? `${API_BASE_URL}/pipeline/chunk?episode_id=${encodeURIComponent(episodeId)}`
    : `${API_BASE_URL}/pipeline/chunk`
  const res = await fetch(url, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`chunk failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function parseEpisode(
  episodeId: string,
  chunkIds?: string[],
): Promise<ParseResult> {
  const res = await fetch(`${API_BASE_URL}/pipeline/parse/${encodeURIComponent(episodeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chunk_ids: chunkIds ?? null }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`parse failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function listEpisodes(): Promise<EpisodeStatus[]> {
  const res = await fetch(`${API_BASE_URL}/pipeline/episodes`)
  if (!res.ok) throw new Error(`listEpisodes failed ${res.status}`)
  return res.json()
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd d:\Animatory\frontend
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors for `pipeline.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/pipeline.ts
git commit -m "feat(frontend): add pipeline API client (chunkTranscript, parseEpisode, listEpisodes)"
```

---

## Task 6: Frontend — `UploadTranscript` component

**Files:**
- Create: `frontend/src/components/UploadTranscript.tsx`
- Modify: `frontend/src/studio/views/ParseView.tsx`

- [ ] **Step 1: Create `frontend/src/components/UploadTranscript.tsx`**

```tsx
// frontend/src/components/UploadTranscript.tsx
import { useRef, useState } from 'react'
import { chunkTranscript, parseEpisode } from '../api/pipeline'
import { api } from '../api'

type Phase = 'idle' | 'chunking' | 'parsing' | 'done' | 'error'

export function UploadTranscript() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [episodeName, setEpisodeName] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [chunkCount, setChunkCount] = useState(0)
  const [error, setError] = useState('')

  function onFileChange(f: File) {
    setFile(f)
    setEpisodeName(f.name.replace(/\.[^.]+$/, ''))
    setPhase('idle')
    setLogs([])
    setError('')
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) onFileChange(f)
  }

  async function process() {
    if (!file) return
    setPhase('chunking')
    setLogs([])
    setError('')
    try {
      const chunkResult = await chunkTranscript(file, episodeName || undefined)
      setChunkCount(chunkResult.chunk_count)
      setLogs(l => [...l, `✓ Chunked: ${chunkResult.chunk_count} chunks`])

      setPhase('parsing')
      const parseResult = await parseEpisode(chunkResult.episode_id)
      setLogs(l => [...l, `⟳ Parsing started (run ${parseResult.run_id})`])

      // Stream progress
      const es = api.streamRun(parseResult.run_id)
      es.addEventListener('message', (ev: Event) => {
        const msg = ev as MessageEvent
        try {
          const event = JSON.parse(msg.data as string)
          if (event.type === 'log') {
            setLogs(l => [...l, event.data.message])
          }
          if (event.type === 'complete') {
            setPhase('done')
            setLogs(l => [...l, `✓ Parse complete`])
            es.close()
          }
          if (event.data?.status === 'failed') {
            setPhase('error')
            setError(event.data.error ?? 'Parse failed')
            es.close()
          }
        } catch {}
      })
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-5 mb-6">
      <h2 className="text-sm font-semibold text-ink mb-3">Upload Transcript</h2>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-hairline rounded-lg p-8 text-center cursor-pointer hover:border-[#3772cf]/50 hover:bg-[#3772cf]/[0.03] transition-colors mb-4"
      >
        <div className="text-steel text-sm">
          {file ? file.name : 'Drop .txt file or click to browse'}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(f) }}
        />
      </div>

      {/* Episode name */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-steel w-28 shrink-0">Episode name</label>
        <input
          value={episodeName}
          onChange={e => setEpisodeName(e.target.value)}
          className="flex-1 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-[#3772cf]"
          placeholder="ep1"
        />
      </div>

      {/* Action button */}
      <button
        onClick={process}
        disabled={!file || phase === 'chunking' || phase === 'parsing'}
        className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
      >
        {phase === 'chunking' ? 'Chunking…' : phase === 'parsing' ? 'Parsing…' : 'Process Transcript'}
      </button>

      {/* Progress log */}
      {logs.length > 0 && (
        <div className="rounded-md border border-hairline bg-surface p-3 font-mono text-xs text-steel space-y-0.5 max-h-40 overflow-y-auto">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-500">{error}</div>
      )}

      {phase === 'done' && (
        <div className="mt-3 text-xs text-[#00b48a] font-medium">
          ✓ {chunkCount} chunks parsed — ready for next phase
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add `UploadTranscript` to `ParseView.tsx`**

In `frontend/src/studio/views/ParseView.tsx`, add the import after the existing imports (after line 8):

```typescript
import { UploadTranscript } from '../../components/UploadTranscript'
```

Then add `<UploadTranscript />` immediately after the `<p>` description tag (after line 46, before the existing `<button onClick={mockUpload}>` drop zone):

```tsx
      <UploadTranscript />
```

- [ ] **Step 3: Verify TypeScript compiles**

```
cd d:\Animatory\frontend
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/UploadTranscript.tsx frontend/src/studio/views/ParseView.tsx
git commit -m "feat(frontend): add UploadTranscript card to ParseView with SSE progress"
```

---

## Task 7: Run full test suite

- [ ] **Step 1: Run all new tests**

```
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_chunker.py tests/test_scene_parser.py tests/test_pipeline_api.py -v
```

Expected: all tests green. Fix any failures before proceeding.

- [ ] **Step 2: Run existing tests to catch regressions**

```
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -v
```

Expected: full suite green.

- [ ] **Step 3: Run self-test CLI against real file**

```
python -m animatory.cli chunk "D:\Animatory\Animatorymockup\test.txt" --output-dir "D:\Animatory\Animatorymockup\processed" --self-test
```

Expected: `Self-test PASSED: all offsets valid.` and manifest written to `D:\Animatory\Animatorymockup\processed\test\manifest.json`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify transcript pipeline — all tests pass, self-test clean"
```
