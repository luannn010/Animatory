# animatory/spellcheck/dictionary.py
"""Layer 1 — the deterministic Vietnamese dictionary gate.

A valid Vietnamese word is, by definition, not a naming/consistency error and not
a typo. Gating LLM/heuristic findings through ``is_valid_word`` removes the bulk
of the false positives (every ``đừng``, ``để``, ``đó``, ``đời`` …) in microseconds
with a guarantee a Q4 model cannot give.

The wordlist is the vendored vi_VN Hunspell dictionary (OpenOffice vi_VN 2.2.0,
see ``data/vi_VN.LICENSE``). Loaded once into a frozenset at first use. If the
file is missing we raise loudly — the gate is NEVER silently skipped (handoff §2).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_DEFAULT_PATH = Path(__file__).resolve().parent / "data" / "vi_VN.dic"


def load_wordlist(path: Path | None = None) -> frozenset[str]:
    """Load the vendored wordlist into a casefolded frozenset.

    The Hunspell ``.dic`` format is a leading word-count line followed by one word
    per line (this vi_VN list carries no affix flags). Raises ``FileNotFoundError``
    if the list is absent — Layer 1 must fail loudly, never skip (handoff §2/§8)."""
    p = path or _DEFAULT_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"Vietnamese wordlist not found at {p}. The dictionary gate (Layer 1) "
            f"cannot be skipped silently — vendor data/vi_VN.dic or pass a path."
        )
    words: set[str] = set()
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines()):
        if i == 0 and line.strip().isdigit():
            continue  # leading count line
        token = line.split("/", 1)[0].strip()  # tolerate /FLAGS even if absent here
        if token:
            words.add(token.casefold())
    return frozenset(words)


@lru_cache(maxsize=1)
def _words() -> frozenset[str]:
    return load_wordlist()


def is_valid_word(word: str) -> bool:
    """True if ``word`` is a valid Vietnamese word (case-insensitive).

    Empty/whitespace is never valid. Used to drop findings on real words."""
    if word is None:
        return False
    w = word.strip().casefold()
    return bool(w) and w in _words()
