# tests/test_spellcheck_naming.py
from __future__ import annotations

from animatory.spellcheck.checker import Finding
from animatory.spellcheck.naming_pass import naming_findings


def test_flags_minority_spelling_across_segments():
    text = "Sarah went home. " * 4 + "Later Sara returned."
    out = naming_findings(text)
    # 'Sara' (minority) should be flagged toward 'Sarah' (dominant).
    saras = [f for f in out if f.original == "Sara"]
    assert saras, "expected the minority spelling to be flagged"
    f = saras[0]
    assert isinstance(f, Finding)
    assert f.type == "naming"
    assert f.suggestion == "Sarah"
    assert text[f.char_start:f.char_end] == "Sara"   # global offsets, exact


def test_no_findings_when_names_consistent():
    text = "Sarah went home. Sarah returned. Sarah slept."
    assert naming_findings(text) == []


def test_ignores_non_name_lowercase_words():
    text = "the cat sat. the car ran. the can fell."   # near-dupes but lowercase
    assert naming_findings(text) == []
