# tests/test_scene_refiner.py
from __future__ import annotations
import json, pytest
from unittest.mock import AsyncMock, patch, MagicMock
from animatory.scene_refiner import proofread_text, refine_scenes


def _make_mock_response(content: str, status: int = 200):
    mock_resp = MagicMock()
    mock_resp.status_code = status
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"choices": [{"message": {"content": content}}]}
    return mock_resp



@pytest.mark.asyncio
async def test_proofread_text_returns_reply_and_corrections():
    payload = {
        "reply": "Found 2 issues.",
        "corrections": [
            {"find": "Tú Ân", "replace": "Tú An", "rationale": "name typo", "all_occurrences": True},
            {"find": "teh", "replace": "the", "rationale": "typo", "all_occurrences": False},
        ],
    }
    with patch("animatory.scene_refiner.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(payload)))
        MockClient.return_value = instance

        out = await proofread_text(
            chunk_id="C001",
            chunk_text="Tú Ân walked. teh end.",
            messages=[{"role": "user", "content": "fix names and typos"}],
        )

    assert out["reply"] == "Found 2 issues."
    assert len(out["corrections"]) == 2
    assert out["corrections"][0]["replace"] == "Tú An"
    assert out["corrections"][0]["all_occurrences"] is True


@pytest.mark.asyncio
async def test_proofread_text_strips_code_fence_and_thinking():
    raw = "<think>reasoning</think>```json\n{\"reply\":\"ok\",\"corrections\":[]}\n```"
    with patch("animatory.scene_refiner.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(raw))
        MockClient.return_value = instance

        out = await proofread_text("C001", "text", [{"role": "user", "content": "hi"}])

    assert out["reply"] == "ok"
    assert out["corrections"] == []


@pytest.mark.asyncio
async def test_refine_scenes_returns_reply_and_proposals():
    payload = {
        "reply": "Darkened the mood.",
        "proposals": [
            {"scene_id": "C001_S02", "changes": {"mood": "ominous"}, "rationale": "user asked"},
        ],
    }
    with patch("animatory.scene_refiner.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(payload)))
        MockClient.return_value = instance

        out = await refine_scenes(
            chunk_id="C001",
            chunk_text="some text",
            scenes=[{"scene_id": "C001_S02", "location": "x", "characters": [],
                     "shot_type": "wide", "action": "a", "dialogue": [], "mood": "calm"}],
            messages=[{"role": "user", "content": "make scene 2 darker"}],
        )

    assert out["reply"] == "Darkened the mood."
    assert out["proposals"][0]["scene_id"] == "C001_S02"
    assert out["proposals"][0]["changes"]["mood"] == "ominous"


@pytest.mark.asyncio
async def test_refine_scenes_retries_then_raises_on_bad_json():
    with patch("animatory.scene_refiner.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response("not json"))
        MockClient.return_value = instance

        with pytest.raises(ValueError, match="could not parse JSON"):
            await refine_scenes("C001", "t", [], [{"role": "user", "content": "hi"}], max_retries=2)
