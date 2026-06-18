# tests/test_chunker.py
from __future__ import annotations
import pytest
from animatory.parsing.chunker import chunk_text, chunk_file, ChunkRecord
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
