# tests/test_spellcheck_dictionary.py
"""Layer 1 — the deterministic Vietnamese dictionary gate.

A finding whose word is a valid Vietnamese word must never reach the UI as a
naming/consistency error. These cover the exact false positives from the live
screenshot (đừng, để, đó, đời, đứa, đầu) plus the do-not-silently-skip rule.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from animatory.spellcheck.dictionary import is_valid_word, load_wordlist


def test_screenshot_false_positives_are_valid_words():
    # Every one of these flooded the UI as a NAMING error; all are real words.
    for w in ["đừng", "để", "đó", "đời", "đứa", "đầu"]:
        assert is_valid_word(w), f"{w!r} should be a valid Vietnamese word"


def test_lookup_is_case_insensitive():
    # Sentence-initial / shouted capitalisation must still match the lowercase entry.
    assert is_valid_word("Để")
    assert is_valid_word("ĐÓ")


def test_genuine_typo_is_not_a_valid_word():
    assert not is_valid_word("điễn")     # the wrong half of "cổ điễn" -> "cổ điển"
    assert is_valid_word("điển")         # the correct spelling IS valid
    assert not is_valid_word("xyzzyq")   # nonsense


def test_blank_is_not_valid():
    assert not is_valid_word("")
    assert not is_valid_word("   ")


def test_missing_wordlist_raises_not_silently_skipped():
    # §2/§8: the dictionary gate must never be silently skipped when the list is
    # absent — loading a missing file is a loud failure, not an empty set.
    with pytest.raises(FileNotFoundError):
        load_wordlist(Path("does/not/exist/vi_VN.dic"))
