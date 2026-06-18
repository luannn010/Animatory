# tests/test_resolve_beats.py
"""Unit tests for the pointer-based beat resolver and beat→struct assembler.

These cover the correctness guarantee of the scene_parser refactor: the model
emits locators (anchors) only, and code lifts every actual string from the
source. Narration/dialogue text is a pure substring of the scene slice by
construction, so corruption is structurally impossible.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from animatory.parsing.scene_parser import _resolve_beats, _assemble_scene


def _reconstruct(scene_text: str, beats: list[dict]) -> str:
    """Concatenate beat spans in order — must rebuild the source byte-for-byte
    because resolved beats tile the whole scene with no gaps/overlaps."""
    return "".join(scene_text[b["start"]:b["end"]] for b in beats)


# ── _resolve_beats: tiling + verbatim lifting ────────────────────────────────

def test_resolve_beats_tiles_and_lifts_verbatim():
    text = 'Trời mưa to. "Đi đi," hắn nói. Cô ấy lặng im.'
    beats = [
        {"type": "narration", "start_anchor": "Trời mưa to.", "end_anchor": "Trời mưa to."},
        {"type": "dialogue", "start_anchor": '"Đi đi,"', "end_anchor": '"Đi đi,"', "speaker": "hắn"},
        {"type": "narration", "start_anchor": "hắn nói.", "end_anchor": "lặng im."},
    ]
    out = _resolve_beats(text, beats)
    # spans tile the whole source exactly — nothing dropped, nothing duplicated
    assert _reconstruct(text, out) == text
    # every lifted text is an exact substring of the source
    for b in out:
        assert b["text"] in text


def test_resolve_beats_repeat_anchor_resolves_in_order():
    text = "Anh nói A roi. Sau do im lang. Anh nói B roi. Het chuyen."
    beats = [
        {"type": "dialogue", "start_anchor": "Anh nói", "end_anchor": "A roi.", "speaker": "X"},
        {"type": "narration", "start_anchor": "Sau do", "end_anchor": "im lang."},
        {"type": "dialogue", "start_anchor": "Anh nói", "end_anchor": "B roi.", "speaker": "X"},
        {"type": "narration", "start_anchor": "Het chuyen.", "end_anchor": "Het chuyen."},
    ]
    out = _resolve_beats(text, beats)
    dlg = [b for b in out if b["type"] == "dialogue"]
    # forward search disambiguates the two identical opening anchors
    assert dlg[0]["text"].endswith("A roi.")
    assert dlg[1]["text"].endswith("B roi.")
    assert dlg[0]["start"] < dlg[1]["start"]
    assert _reconstruct(text, out) == text


def test_resolve_beats_recovers_gap_never_drops_source():
    text = "Alpha mo dau. DOAN GIUA BI BO QUEN. Omega ket thuc."
    beats = [
        {"type": "narration", "start_anchor": "Alpha mo dau.", "end_anchor": "Alpha mo dau."},
        # the middle beat is intentionally missing from the model output
        {"type": "narration", "start_anchor": "Omega ket thuc.", "end_anchor": "Omega ket thuc."},
    ]
    out = _resolve_beats(text, beats)
    assert _reconstruct(text, out) == text
    joined = " ".join(b["text"] for b in out)
    assert "DOAN GIUA BI BO QUEN" in joined          # gap text recovered
    assert any(b.get("inferred") for b in out)         # surfaced as an inferred beat


def test_resolve_beats_unresolvable_anchor_is_flagged_not_aborted():
    text = "Mo dau that su. Roi them mot it. Ket thuc o day."
    beats = [
        {"type": "narration", "start_anchor": "Mo dau that su.", "end_anchor": "Mo dau that su."},
        {"type": "dialogue", "start_anchor": "KHONG CO TRONG VAN BAN", "end_anchor": "CUNG KHONG CO", "speaker": "Y"},
        {"type": "narration", "start_anchor": "Ket thuc o day.", "end_anchor": "Ket thuc o day."},
    ]
    out = _resolve_beats(text, beats)
    # one bad anchor must not abort the scene, and tiling still holds
    assert _reconstruct(text, out) == text
    assert any(b.get("beat_unresolved") for b in out)


def test_resolve_beats_preserves_source_typo():
    # The source contains a typo ('hắng'); the parser lifts it verbatim and must
    # never "fix" it — spelling is the separate spellcheck pass's job.
    text = 'Hắn hắng giọng. "Im đi," hắn quát.'
    beats = [
        {"type": "narration", "start_anchor": "Hắn hắng giọng.", "end_anchor": "Hắn hắng giọng."},
        {"type": "dialogue", "start_anchor": '"Im đi,"', "end_anchor": "hắn quát.", "speaker": "hắn"},
    ]
    out = _resolve_beats(text, beats)
    assert any("hắng" in b["text"] for b in out)


# ── _assemble_scene: beats → external struct ─────────────────────────────────

def test_assemble_scene_maps_beats_to_struct_with_verbatim_text():
    text = 'Trời tối. "Lại đây," cô gọi. Hắn bước tới.'
    resolved = _resolve_beats(text, [
        {"type": "narration", "start_anchor": "Trời tối.", "end_anchor": "Trời tối."},
        {"type": "dialogue", "start_anchor": '"Lại đây,"', "end_anchor": '"Lại đây,"',
         "speaker": "cô", "speaker_cue": "cô gọi", "speaker_confidence": "high",
         "emotion": "tender", "intensity": "medium"},
        {"type": "narration", "start_anchor": "Hắn bước tới.", "end_anchor": "Hắn bước tới."},
    ])
    scene = _assemble_scene("C001_S01", text, {"location": "Sân", "shot_type": "medium",
                                               "mood": "lặng lẽ", "hint_characters": ["cô", "hắn"]}, resolved)
    assert scene["scene_id"] == "C001_S01"
    assert scene["location"] == "Sân"
    # every narration entry and dialogue line is an exact substring of the source
    for n in scene["narration"]:
        assert n in text
    assert len(scene["dialogue"]) == 1
    d = scene["dialogue"][0]
    assert d["line"] in text
    assert d["character"] == "cô"
    assert d["emotion"] == "tender"
    assert d["intensity"] == "medium"
    # persist-both: confidence + cue carried onto the line
    assert d["speaker_confidence"] == "high"
    assert d["speaker_cue"] == "cô gọi"


def test_assemble_scene_drops_unknown_from_roster_keeps_on_line():
    text = '"Ai do?" mot giong vang len. "La toi," Lan dap.'
    resolved = _resolve_beats(text, [
        {"type": "dialogue", "start_anchor": '"Ai do?"', "end_anchor": '"Ai do?"',
         "speaker": "Unknown", "speaker_cue": "none", "speaker_confidence": "low"},
        {"type": "narration", "start_anchor": "mot giong", "end_anchor": "vang len."},
        {"type": "dialogue", "start_anchor": '"La toi,"', "end_anchor": '"La toi,"',
         "speaker": "Lan", "speaker_cue": "Lan dap", "speaker_confidence": "high"},
        {"type": "narration", "start_anchor": "Lan dap.", "end_anchor": "Lan dap."},
    ])
    scene = _assemble_scene("C001_S01", text, {}, resolved)
    # Unknown stays on the dialogue line but is excluded from the roster
    assert scene["dialogue"][0]["character"] == "Unknown"
    assert "Unknown" not in scene["characters"]
    assert "Lan" in scene["characters"]


def test_assemble_scene_drops_speaker_cue_not_in_source():
    text = '"Cha toi day," cau noi.'
    resolved = _resolve_beats(text, [
        {"type": "dialogue", "start_anchor": '"Cha toi day,"', "end_anchor": "cau noi.",
         "speaker": "cau", "speaker_cue": "HALLUCINATED CUE", "speaker_confidence": "high"},
    ])
    scene = _assemble_scene("C001_S01", text, {}, resolved)
    # a cue the model invented (not a substring) is demoted to "none"
    assert scene["dialogue"][0]["speaker_cue"] == "none"


_C001 = Path(__file__).resolve().parent.parent / "processed" / "new1__test" / "C001.txt"


@pytest.mark.skipif(not _C001.exists(), reason="real C001.txt fixture not present")
def test_resolve_beats_reconstructs_real_vietnamese_slice():
    """Tiling reconstruction on real multi-byte Vietnamese source (handoff §8).

    Derive beats from the source itself (sentence boundaries) so this needs no
    model, then assert the resolved spans rebuild the slice byte-for-byte — the
    offset arithmetic must be correct on real non-ASCII text.
    """
    full = _C001.read_text(encoding="utf-8")
    slice_text = full[: full.find("\n\n", 4000) if full.find("\n\n", 4000) != -1 else 4000]

    # Split into sentences and turn each into a (first words, last words) locator.
    import re as _re
    sentences = [s for s in _re.split(r"(?<=[.!?…”\"])\s+", slice_text) if s.strip()]
    beats = []
    for s in sentences:
        words = s.split()
        head = " ".join(words[:4])
        tail = " ".join(words[-4:])
        beats.append({"type": "narration", "start_anchor": head, "end_anchor": tail})

    out = _resolve_beats(slice_text, beats)
    assert _reconstruct(slice_text, out) == slice_text
    for b in out:
        assert b["text"] in slice_text


def test_assemble_scene_action_beats_join_into_action_field():
    text = "Han rut kiem ra. Roi lao toi. Ket thuc tran dau."
    resolved = _resolve_beats(text, [
        {"type": "action", "start_anchor": "Han rut kiem ra.", "end_anchor": "Roi lao toi."},
        {"type": "narration", "start_anchor": "Ket thuc tran dau.", "end_anchor": "Ket thuc tran dau."},
    ])
    scene = _assemble_scene("C001_S01", text, {}, resolved)
    assert "Han rut kiem ra." in scene["action"]
    assert scene["narration"] == ["Ket thuc tran dau."]
