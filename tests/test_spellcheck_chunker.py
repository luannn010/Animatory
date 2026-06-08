# tests/test_spellcheck_chunker.py
from __future__ import annotations

from animatory.spellcheck.chunker import Segment, segment_document


def test_reconstruction_is_byte_for_byte():
    # ~3,800 words across many paragraphs → the handoff's 5-7 segment band.
    paras = [f"Paragraph number {i}. " + ("word " * 100) for i in range(36)]
    text = "\n\n".join(paras)
    segments = segment_document(text)
    assert 5 <= len(segments) <= 7
    rebuilt = "".join(s.text for s in segments)
    assert rebuilt == text  # offsets cover the whole string, in order, no loss


def test_offsets_map_back_to_original():
    text = "Alpha beta gamma.\n\nDelta epsilon zeta.\n\nEta theta iota kappa."
    segments = segment_document(text, target_words=4)
    for seg in segments:
        assert text[seg.char_offset:seg.char_offset + len(seg.text)] == seg.text


def test_indices_are_stable_and_ordered():
    text = "\n\n".join(f"Para {i} " + "lorem " * 100 for i in range(6))
    segments = segment_document(text)
    assert [s.segment_index for s in segments] == list(range(len(segments)))
    assert segments == sorted(segments, key=lambda s: s.char_offset)


def test_never_splits_mid_sentence_when_paragraphs_fit():
    text = "\n\n".join("Sentence one. Sentence two." for _ in range(6))
    segments = segment_document(text, target_words=4)
    for seg in segments:
        assert seg.text.strip()[0].isupper() or seg.char_offset == 0
