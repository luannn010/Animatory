# animatory/scene_source.py
from __future__ import annotations

import re
from typing import TypedDict

MIN_NEEDLE_CHARS = 8

_WS_RE = re.compile(r"\s+")
# Stripped from the edges only: quotes, dialogue dashes, ellipsis, outer punctuation.
# Diacritics are intentionally preserved (no accent folding).
_EDGE_CHARS = "\"'“”‘’«»—–-…().,!?;: "


class SceneSource(TypedDict):
    found: bool
    match_lines: list[int]   # 0-based indices into chunk_text.splitlines()
    line_start: int          # min(match_lines), or -1 when none
    line_end: int            # max(match_lines), or -1 when none
    excerpt: str             # lines[line_start..line_end] joined, or ""


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", s).strip().lower().strip(_EDGE_CHARS)


def _needles(scene: dict) -> list[str]:
    out: list[str] = []
    for d in scene.get("dialogue") or []:
        if isinstance(d, dict) and d.get("line"):
            out.append(d["line"])
    for n in scene.get("narration") or []:
        if n:
            out.append(n)
    if scene.get("action"):
        out.append(scene["action"])
    return out


def locate(scene: dict, chunk_text: str) -> SceneSource:
    """Best-effort: which chapter lines did this scene come from?

    Heuristic normalized-substring matching of the scene's dialogue lines,
    narration, and action against the chapter's lines. Pure; no I/O.
    """
    lines = chunk_text.splitlines()
    norm_lines = [_norm(ln) for ln in lines]
    needles = [n for n in (_norm(x) for x in _needles(scene)) if len(n) >= MIN_NEEDLE_CHARS]

    matched: set[int] = set()
    for needle in needles:
        for i, ln in enumerate(norm_lines):
            if not ln:
                continue
            if needle in ln or (len(ln) >= MIN_NEEDLE_CHARS and ln in needle):
                matched.add(i)

    if not matched:
        return {"found": False, "match_lines": [], "line_start": -1, "line_end": -1, "excerpt": ""}

    ordered = sorted(matched)
    start, end = ordered[0], ordered[-1]
    return {
        "found": True,
        "match_lines": ordered,
        "line_start": start,
        "line_end": end,
        "excerpt": "\n".join(lines[start : end + 1]),
    }
