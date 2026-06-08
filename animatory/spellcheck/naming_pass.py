# animatory/spellcheck/naming_pass.py
from __future__ import annotations

import re
from collections import Counter

from animatory.spellcheck.checker import Finding

# Capitalised tokens (incl. Vietnamese diacritics) of length >= 2. We accept all
# and rely on frequency clustering to find inconsistent proper nouns.
_NAME_RE = re.compile(r"\b([A-ZĐÀ-Ỹ][\wÀ-ỹ]{1,})\b")


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def naming_findings(text: str) -> list[Finding]:
    """Flag minority spellings of near-duplicate proper nouns across the whole
    document. Deterministic edit-distance clustering — no LLM call. Findings
    carry global offsets into `text`."""
    tokens = [(m.group(1), m.start()) for m in _NAME_RE.finditer(text)]
    counts = Counter(tok for tok, _ in tokens)
    names = list(counts)

    # Cluster names within edit-distance 1 of a strictly more frequent name.
    canonical: dict[str, str] = {}
    for name in names:
        best = None
        for other in names:
            if other == name or counts[other] <= counts[name]:
                continue
            if _levenshtein(name, other) == 1 and abs(len(name) - len(other)) <= 1:
                if best is None or counts[other] > counts[best]:
                    best = other
        if best is not None:
            canonical[name] = best

    out: list[Finding] = []
    for tok, start in tokens:
        target = canonical.get(tok)
        if target is None:
            continue
        out.append(Finding(
            type="naming", original=tok, suggestion=target,
            char_start=start, char_end=start + len(tok),
            reason=f"inconsistent with dominant spelling “{target}”",
        ))
    return out
