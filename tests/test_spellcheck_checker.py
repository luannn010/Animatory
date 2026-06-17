# tests/test_spellcheck_checker.py
from __future__ import annotations

import pytest
from unittest.mock import patch

import animatory.spellcheck.checker as checker
from animatory.spellcheck.checker import Finding, check_segment, clear_cache


@pytest.fixture(autouse=True)
def _reset_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.mark.asyncio
async def test_findings_get_global_offsets_and_verify_substring():
    seg = "the protagnist arrived"   # local index of 'protagnist' is 4
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "protagnist", "suggestion": "protagonist",
             "char_start": 4, "char_end": 14, "reason": "misspelling", "rule": "not-a-word"},
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=1000, known=known)

    assert len(out) == 1
    f = out[0]
    assert isinstance(f, Finding)
    assert f.char_start == 1004 and f.char_end == 1014   # +char_offset applied
    assert f.original == "protagnist"
    assert f.rule == "not-a-word"                        # Layer 3: rule carried through


@pytest.mark.asyncio
async def test_findings_with_wrong_local_span_are_dropped():
    seg = "all spellings fine here"
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "zzz", "suggestion": "z", "rule": "not-a-word",
             "char_start": 0, "char_end": 3, "reason": "x"},  # slice != original -> drop
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)

    assert out == []


@pytest.mark.asyncio
async def test_relocates_to_occurrence_closest_to_model_start():
    # "qqq" appears 3x; model points (wrongly) near the THIRD one. The relocate
    # fallback must bind to the closest occurrence, not the first. (Non-dictionary
    # token so the same-meaning gate doesn't interfere with the relocate check.)
    seg = "qqq ... qqq ... qqq done"   # indices: 0, 8, 16
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "qqq", "suggestion": "qqz", "rule": "not-a-word",
             "char_start": 15, "char_end": 18, "reason": "typo"},  # off-by-one near idx 16
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)

    assert len(out) == 1
    assert out[0].char_start == 16 and out[0].char_end == 19   # closest, not first (0)
    assert seg[out[0].char_start:out[0].char_end] == "qqq"


@pytest.mark.asyncio
async def test_same_meaning_swap_is_dropped():
    # Layer 4: 'để' and 'đó' are BOTH valid words — swapping one for the other is
    # a meaning change, not a typo. Drop it even if the model proposes it (§7).
    seg = "Anh để nó ở đây."
    i = seg.index("để")
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "để", "suggestion": "đó", "rule": "wrong-diacritic",
             "char_start": i, "char_end": i + 2, "reason": "x"},
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)
    assert out == []


@pytest.mark.asyncio
async def test_genuine_typo_survives():
    # 'điễn' is NOT a valid word -> not a same-meaning swap -> the real typo
    # correction to 'điển' survives the gate (§7).
    seg = "Một tác phẩm cổ điễn."
    i = seg.index("điễn")
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "điễn", "suggestion": "điển", "rule": "wrong-diacritic",
             "char_start": i, "char_end": i + len("điễn"), "reason": "diacritics"},
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)
    assert len(out) == 1
    assert out[0].suggestion == "điển" and out[0].rule == "wrong-diacritic"


@pytest.mark.asyncio
async def test_finding_without_valid_rule_is_dropped():
    # Layer 4: no valid rule -> invalid finding -> drop.
    seg = "the protagnist arrived"
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "protagnist", "suggestion": "protagonist",
             "char_start": 4, "char_end": 14, "reason": "x"},               # no rule
            {"type": "spelling", "original": "protagnist", "suggestion": "protagonist",
             "char_start": 4, "char_end": 14, "reason": "x", "rule": "style"},  # bogus rule
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)
    assert out == []


@pytest.mark.asyncio
async def test_llm_naming_type_is_dropped():
    # Naming/consistency is owned by the deterministic Layer 2 pass now; the LLM
    # must not adjudicate it. Any naming-typed finding from the LLM is dropped.
    seg = "Hôm nay Tieu đến."
    i = seg.index("Tieu")
    known = {"characters": ["Tiêu Lan Nhi"], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "naming", "original": "Tieu", "suggestion": "Tiêu", "rule": "misspelled-name",
             "char_start": i, "char_end": i + 4, "reason": "x"},
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)
    assert out == []


@pytest.mark.asyncio
async def test_bad_llm_output_raises_valueerror():
    # _call_qwen already raises ValueError after retries on unparseable output;
    # check_segment must let that propagate so the router can emit a chunk error.
    async def fake_call(prompt, *, label, **kw):
        raise ValueError("could not parse JSON from Qwen response")

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        with pytest.raises(ValueError, match="could not parse JSON"):
            await check_segment("text", char_offset=0, known={"characters": [], "locations": []})


@pytest.mark.asyncio
async def test_cache_hits_skip_second_call():
    seg = "the protagnist"
    known = {"characters": [], "locations": []}
    calls = 0

    async def fake_call(prompt, *, label, **kw):
        nonlocal calls
        calls += 1
        return {"findings": [
            {"type": "spelling", "original": "protagnist", "suggestion": "protagonist",
             "char_start": 4, "char_end": 14, "reason": "x", "rule": "not-a-word"},
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        await check_segment(seg, char_offset=0, known=known)
        out = await check_segment(seg, char_offset=50, known=known)  # same text, new offset

    assert calls == 1                       # second call served from cache
    assert out[0].char_start == 54          # offsets recomputed from cached local span


@pytest.mark.asyncio
async def test_cache_is_bounded_and_evicts_lru(monkeypatch):
    monkeypatch.setattr(checker, "_CACHE_MAX", 2)
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": []}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        # Three distinct segments with a cap of 2 -> oldest is evicted.
        await check_segment("alpha one", char_offset=0, known=known)
        await check_segment("beta two", char_offset=0, known=known)
        await check_segment("gamma three", char_offset=0, known=known)

    assert len(checker._CACHE) == 2
    assert checker._seg_hash("alpha one") not in checker._CACHE   # LRU evicted
    assert checker._seg_hash("gamma three") in checker._CACHE
