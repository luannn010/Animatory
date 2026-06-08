# tests/test_spellcheck_checker.py
from __future__ import annotations

import pytest
from unittest.mock import patch

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
