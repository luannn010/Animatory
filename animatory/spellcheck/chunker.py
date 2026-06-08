# animatory/spellcheck/chunker.py
from __future__ import annotations

import re
from dataclasses import dataclass

# Split points that preserve the exact original string. Both are ZERO-WIDTH so
# `re.split` removes no characters — concatenating the pieces reproduces the
# input byte-for-byte. The sentence boundary sits between end punctuation and the
# following whitespace, so the whitespace stays attached to the next piece (and
# we never split things like "3.14" where the next char isn't whitespace).
_PARA_RE = re.compile(r"(?<=\n\n)")            # boundary after a blank line
_SENT_RE = re.compile(r"(?<=[.!?…])(?=\s)")    # boundary after sentence punctuation


@dataclass(frozen=True)
class Segment:
    segment_index: int
    char_offset: int
    text: str
    word_count: int


def _words(s: str) -> int:
    return len(s.split())


def _pieces(text: str, target_max: int) -> list[str]:
    """Paragraph pieces; oversized paragraphs fall back to sentence pieces.
    Concatenating the result always equals `text` (delimiters are retained)."""
    paras = _PARA_RE.split(text)
    out: list[str] = []
    for para in paras:
        if _words(para) <= target_max:
            out.append(para)
        else:
            out.extend(_SENT_RE.split(para))
    return [p for p in out if p != ""]


def segment_document(text: str, target_words: int | None = None) -> list[Segment]:
    """Split `text` into boundary-safe segments, each tagged with its start offset.

    Targets 5-7 segments for typical chapter lengths. Splits on paragraph
    boundaries first, falling back to sentence boundaries for oversized
    paragraphs. Never splits mid-sentence. The concatenation of segment texts
    (in order) reproduces `text` exactly, so global offsets are exact."""
    if not text:
        return []
    if target_words is None:
        # Midpoint of the handoff's 550-760 word band → ~5-7 segments for a
        # typical ~3,800-word chapter; fewer for shorter text.
        target_words = 650
    target_words = max(target_words, 1)

    pieces = _pieces(text, target_words)
    segments: list[Segment] = []
    offset = 0
    buf = ""
    buf_start = 0
    for piece in pieces:
        if buf and _words(buf) + _words(piece) > target_words:
            segments.append(Segment(len(segments), buf_start, buf, _words(buf)))
            buf = ""
            buf_start = offset
        if not buf:
            buf_start = offset
        buf += piece
        offset += len(piece)
    if buf:
        segments.append(Segment(len(segments), buf_start, buf, _words(buf)))
    return segments
