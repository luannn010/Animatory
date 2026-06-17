# tests/test_spellcheck_naming.py
from __future__ import annotations

from animatory.spellcheck.checker import Finding
from animatory.spellcheck.naming_pass import (
    naming_findings,
    registry_name_findings,
    combined_naming_findings,
)


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


def test_naming_excludes_valid_dictionary_words():
    # 'Cổ' and 'Cỗ' are BOTH real Vietnamese words within edit-distance 1; the
    # minority must NOT be flagged as a naming error (Layer 1 dictionary gate).
    text = "Cổ Cổ Cổ Cỗ."
    assert naming_findings(text) == []


# ── Layer 2: registry-aware naming (edit-distance to a REGISTERED name) ───────

def test_registry_flags_misspelled_name_edit_distance_1():
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}
    text = "Hôm nay Tieu đến trễ."          # 'Tieu' is missing the ê diacritic
    out = registry_name_findings(text, known)
    hits = [f for f in out if f.original == "Tieu"]
    assert hits, "an edit-distance-1 misspelling of a registered name must be flagged"
    f = hits[0]
    assert f.type == "naming"
    assert f.suggestion == "Tiêu"
    assert text[f.char_start:f.char_end] == "Tieu"   # exact global offsets
    assert "Tiêu" in f.reason


def test_registry_does_not_flag_function_words():
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}
    text = "Cô ấy đừng làm đó, đừng đời nào."   # function words, none near a name
    assert registry_name_findings(text, known) == []


def test_registry_does_not_flag_correctly_spelled_name():
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}
    text = "Tiêu Lan Nhi cười lạnh."
    assert registry_name_findings(text, known) == []


def test_registry_does_not_flag_valid_word_near_a_name():
    # A real word that happens to be edit-distance-1 from a name token is NOT a
    # name typo — the dictionary gate protects it.
    known = {"characters": ["Cỗ Máy"], "locations": []}   # contrived canonical
    text = "Cổ tay của cô ấy."                            # 'Cổ' is a real word
    assert registry_name_findings(text, known) == []


# ── composition: registry + frequency, deduped & deterministic (§7) ───────────

def test_combined_merges_registry_and_frequency():
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}
    text = "Tieu. " + "Sarah ok. " * 4 + "Sara done."   # Tieu=registry, Sara=frequency
    out = combined_naming_findings(text, known)
    origs = {f.original for f in out}
    assert "Tieu" in origs       # registry near-miss
    assert "Sara" in origs       # frequency minority


def test_combined_is_deterministic():
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}
    text = "Tieu. " + "Sarah ok. " * 4 + "Sara done."
    a = [f.to_dict() for f in combined_naming_findings(text, known)]
    b = [f.to_dict() for f in combined_naming_findings(text, known)]
    assert a == b                # stateless, no randomness


def test_combined_dedupes_same_offset_token():
    # Both passes flag 'Sara' at the same offsets -> it must appear once.
    known = {"characters": ["Sarah"], "locations": []}
    text = "Sarah ok. " * 4 + "Sara here."
    out = combined_naming_findings(text, known)
    keys = [(f.char_start, f.original) for f in out]
    assert len(keys) == len(set(keys))


def test_combined_consistency_same_valid_word_treated_identically():
    # The same valid word appearing in two places (think chunk 1 vs chunk 7) is
    # never flagged in either — consistency by construction (§7).
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}
    text = "Cô đừng đó. " * 2 + "Sau này đừng làm đó nữa."
    out = combined_naming_findings(text, known)
    assert all(f.original.casefold() not in {"đừng", "đó"} for f in out)
