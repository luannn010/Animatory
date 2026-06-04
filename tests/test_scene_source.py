# tests/test_scene_source.py
from __future__ import annotations
from animatory.scene_source import locate, MIN_NEEDLE_CHARS

CHAPTER = "\n".join([
    "Tu An chạy trốn khỏi phủ công chúa.",          # 0
    "— Từ An, sao rồi? Thành công chưa?",            # 1
    "— Đúng đó, mau nói kết quả đi.",                # 2
    "Một đoạn không liên quan ở giữa.",              # 3 (between matches)
    "Trương An Thế bước vào, lạnh lùng nhìn quanh.", # 4
])


def test_locate_finds_contiguous_span():
    scene = {
        "action": "Tu An chạy trốn khỏi phủ công chúa.",
        "dialogue": [
            {"character": "Triệu Cao", "line": "Từ An, sao rồi? Thành công chưa?"},
            {"character": "Trương An Thế", "line": "Trương An Thế bước vào, lạnh lùng nhìn quanh."},
        ],
        "narration": [],
    }
    res = locate(scene, CHAPTER)
    assert res["found"] is True
    assert res["line_start"] == 0
    assert res["line_end"] == 4
    assert 0 in res["match_lines"] and 1 in res["match_lines"] and 4 in res["match_lines"]
    assert "Trương An Thế" in res["excerpt"]


def test_locate_ignores_short_needles():
    scene = {"action": "", "dialogue": [{"character": "X", "line": "Ừ."}], "narration": []}
    res = locate(scene, CHAPTER)
    assert res["found"] is False
    assert res["match_lines"] == []
    assert res["line_start"] == -1


def test_locate_preserves_diacritics():
    # Needle without diacritics must NOT match the accented chapter line.
    scene = {"action": "Truong An The buoc vao, lanh lung nhin quanh.",
             "dialogue": [], "narration": []}
    res = locate(scene, CHAPTER)
    assert res["found"] is False


def test_locate_indices_valid_against_splitlines():
    scene = {"action": "", "narration": ["Tu An chạy trốn khỏi phủ công chúa."], "dialogue": []}
    res = locate(scene, CHAPTER)
    n = len(CHAPTER.splitlines())
    assert all(0 <= i < n for i in res["match_lines"])
    assert MIN_NEEDLE_CHARS == 8
