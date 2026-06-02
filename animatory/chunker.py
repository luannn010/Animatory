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
            # warn if: boundary found but far, OR no boundary found and overrun is large
            if (boundary - pos) > target_words + 500:
                warned.add(len(records))
            end = boundary  # may equal n if no boundary found

        # char_end: exclusive index right after the last character of words[end-1]
        char_start = offsets[pos]
        char_end = offsets[end - 1] + len(words[end - 1])
        chunk_text_str = text[char_start:char_end]

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

        # If we consumed all words, we're done
        if end == n:
            break

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
    words, _ = _build_word_offsets(text)
    records = chunk_text(text, target_words=target_words, overlap_words=overlap_words, min_chunk_words=min_chunk_words)

    for r in records:
        (output_dir / f"{r.chunk_id}.txt").write_text(r.text, encoding="utf-8")

    manifest = {
        "source_file": source_path.name,
        "total_words": len(words),
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
