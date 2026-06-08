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
             "char_start": 4, "char_end": 14, "reason": "misspelling"},
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=1000, known=known)

    assert len(out) == 1
    f = out[0]
    assert isinstance(f, Finding)
    assert f.char_start == 1004 and f.char_end == 1014   # +char_offset applied
    assert f.original == "protagnist"


@pytest.mark.asyncio
async def test_findings_with_wrong_local_span_are_dropped():
    seg = "all spellings fine here"
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "zzz", "suggestion": "z",
             "char_start": 0, "char_end": 3, "reason": "x"},  # slice != original -> drop
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)

    assert out == []


@pytest.mark.asyncio
async def test_relocates_to_occurrence_closest_to_model_start():
    # "lan" appears 3x; model points (wrongly) near the THIRD one. The relocate
    # fallback must bind to the closest occurrence, not the first.
    seg = "lan ... lan ... lan done"   # indices: 0, 8, 16
    known = {"characters": [], "locations": []}

    async def fake_call(prompt, *, label, **kw):
        return {"findings": [
            {"type": "spelling", "original": "lan", "suggestion": "làn",
             "char_start": 15, "char_end": 18, "reason": "diacritics"},  # off-by-one near idx 16
        ]}

    with patch("animatory.spellcheck.checker._call_qwen", side_effect=fake_call):
        out = await check_segment(seg, char_offset=0, known=known)

    assert len(out) == 1
    assert out[0].char_start == 16 and out[0].char_end == 19   # closest, not first (0)
    assert seg[out[0].char_start:out[0].char_end] == "lan"


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
             "char_start": 4, "char_end": 14, "reason": "x"},
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
