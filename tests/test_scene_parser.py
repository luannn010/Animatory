# tests/test_scene_parser.py
from __future__ import annotations
import json, pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from animatory.scene_parser import parse_chunk, parse_episode

FAKE_SCENES_RESPONSE = {
    "chunk_id": "C001",
    "scenes": [
        {
            "scene_id": "C001_S01",
            "location": "Palace chamber",
            "characters": ["Tu An", "Princess"],
            "shot_type": "medium",
            "action": "Tu An lies bound to the bed",
            "dialogue": [{"character": "Tu An", "line": "Me kiep!"}],
            "mood": "tense",
        }
    ],
}

def _make_mock_response(content: str, status: int = 200):
    mock_resp = MagicMock()
    mock_resp.status_code = status
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": content}}]
    }
    return mock_resp


@pytest.mark.asyncio
async def test_parse_chunk_writes_json(tmp_path):
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(FAKE_SCENES_RESPONSE)))
        MockClient.return_value = instance

        out = await parse_chunk(
            chunk_id="C001",
            chunk_text="Me kiep, test text.",
            episode_id="ep1",
            output_dir=tmp_path,
        )

    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["chunk_id"] == "C001"
    assert len(data["scenes"]) == 1
    assert data["scenes"][0]["scene_id"] == "C001_S01"


@pytest.mark.asyncio
async def test_parse_chunk_retries_on_bad_json(tmp_path):
    bad = "not json at all"
    good = json.dumps(FAKE_SCENES_RESPONSE)
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            return _make_mock_response(bad)
        return _make_mock_response(good)

    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=side_effect)
        MockClient.return_value = instance

        out = await parse_chunk("C001", "text", "ep1", tmp_path, max_retries=3)

    assert call_count == 3
    assert out.exists()


@pytest.mark.asyncio
async def test_parse_chunk_fails_after_max_retries(tmp_path):
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response("not json"))
        MockClient.return_value = instance

        with pytest.raises(ValueError, match="could not parse JSON"):
            await parse_chunk("C001", "text", "ep1", tmp_path, max_retries=2)


@pytest.mark.asyncio
async def test_parse_episode_processes_all_chunks(tmp_path):
    ep_dir = tmp_path / "ep1"
    ep_dir.mkdir()
    (ep_dir / "C001.txt").write_text("chunk one text.", encoding="utf-8")
    (ep_dir / "C002.txt").write_text("chunk two text.", encoding="utf-8")
    manifest = {
        "source_file": "ep1.txt",
        "chunk_count": 2,
        "chunks": [
            {"chunk_id": "C001", "file": "C001.txt", "char_start": 0, "char_end": 15},
            {"chunk_id": "C002", "file": "C002.txt", "char_start": 16, "char_end": 31},
        ],
    }
    (ep_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with patch("animatory.scene_parser.parse_chunk", new_callable=AsyncMock) as mock_pc:
        mock_pc.return_value = ep_dir / "C001_scenes.json"
        await parse_episode("ep1", ep_dir)

    assert mock_pc.call_count == 2
