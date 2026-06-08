# tests/test_scene_parser.py
from __future__ import annotations
import json, pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from animatory.scene_parser import parse_chunk, parse_episode, _slice_by_anchors

# Beats-locator contract: the model emits anchors (locators) only; code lifts
# every actual string from the source text below.
# The quote-boundary rule: the dialogue beat is the quote ONLY; the speech tag
# is its own narration beat (split at the ").
FAKE_CHUNK_TEXT = 'Tu An nam tren giuong, han quat lon: "Me kiep!"'
FAKE_SCENES_RESPONSE = {
    "chunk_id": "C001",
    "scenes": [
        {
            "scene_id": "C001_S01",
            "location": "Palace chamber",
            "shot_type": "medium",
            "mood": "tense",
            "beats": [
                {"type": "narration", "start_anchor": "Tu An nam tren giuong,",
                 "end_anchor": "han quat lon:"},
                {"type": "dialogue", "start_anchor": '"Me kiep!"', "end_anchor": '"Me kiep!"',
                 "speaker": "Tu An", "speaker_cue": "han quat lon",
                 "speaker_confidence": "high", "emotion": "angry"},
            ],
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
            chunk_text=FAKE_CHUNK_TEXT,
            episode_id="ep1",
            output_dir=tmp_path,
        )

    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["chunk_id"] == "C001"
    assert len(data["scenes"]) == 1
    scene = data["scenes"][0]
    assert scene["scene_id"] == "C001_S01"
    # text is LIFTED verbatim from the source, never regenerated
    assert scene["narration"] == ["Tu An nam tren giuong, han quat lon:"]
    assert scene["dialogue"][0]["line"] == '"Me kiep!"'
    assert scene["dialogue"][0]["character"] == "Tu An"
    # persist-both: attribution metadata survives onto the line
    assert scene["dialogue"][0]["speaker_confidence"] == "high"
    assert scene["dialogue"][0]["speaker_cue"] == "han quat lon"


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

        out = await parse_chunk("C001", FAKE_CHUNK_TEXT, "ep1", tmp_path, max_retries=3)

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


@pytest.mark.asyncio
async def test_parse_episode_prefers_edited_text(tmp_path):
    ep_dir = tmp_path / "ep1"
    ep_dir.mkdir()
    (ep_dir / "C001.txt").write_text("original text.", encoding="utf-8")
    (ep_dir / "C001.edited.txt").write_text("cleaned text.", encoding="utf-8")
    manifest = {
        "source_file": "ep1.txt", "chunk_count": 1,
        "chunks": [{"chunk_id": "C001", "file": "C001.txt", "char_start": 0, "char_end": 14}],
    }
    (ep_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    seen = {}
    async def fake_parse_chunk(*, chunk_id, chunk_text, episode_id, output_dir, **kw):
        seen["text"] = chunk_text
        return output_dir / f"{chunk_id}_scenes.json"

    with patch("animatory.scene_parser.parse_chunk", side_effect=fake_parse_chunk):
        await parse_episode("ep1", ep_dir)

    assert seen["text"] == "cleaned text."


from animatory import entity_registry as er

ENRICHED_CHUNK_TEXT = 'Đêm xuống. đại cản bước vào "Quỳ."'
ENRICHED_RESPONSE = {
    "chunk_id": "C001",
    "scenes": [
        {
            "scene_id": "C001_S01",
            "location": "cao palace",
            "shot_type": "wide",
            "mood": "tense",
            "beats": [
                {"type": "narration", "start_anchor": "Đêm xuống.", "end_anchor": "Đêm xuống."},
                {"type": "action", "start_anchor": "đại cản bước vào", "end_anchor": "đại cản bước vào"},
                {"type": "dialogue", "start_anchor": '"Quỳ."', "end_anchor": '"Quỳ."',
                 "speaker": "đại cản", "speaker_cue": "đại cản bước vào",
                 "speaker_confidence": "high", "emotion": "commanding", "intensity": "high"},
            ],
        }
    ],
}


@pytest.mark.asyncio
async def test_parse_chunk_normalizes_and_grows_registry(tmp_path):
    # Seed a registry with a canonical + alias so normalization is deterministic.
    er.save(
        er.EntityRegistry(
            episode_id="ep1",
            characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
            locations=[{"canonical": "Cao's Palace", "aliases": ["cao palace"]}],
        ),
        tmp_path,
        now="2026-06-04T00:00:00Z",
    )

    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(ENRICHED_RESPONSE)))
        MockClient.return_value = instance
        out = await parse_chunk("C001", ENRICHED_CHUNK_TEXT, "ep1", tmp_path)

    scene = json.loads(out.read_text(encoding="utf-8"))["scenes"][0]
    assert scene["location"] == "Cao's Palace"
    assert scene["characters"] == ["Đại Càn"]
    assert scene["dialogue"][0]["character"] == "Đại Càn"
    assert scene["dialogue"][0]["emotion"] == "commanding"
    assert scene["narration"] == ["Đêm xuống."]
    assert scene["action"] == "đại cản bước vào"

    reg = er.load("ep1", tmp_path)
    assert [e["canonical"] for e in reg.characters] == ["Đại Càn"]


@pytest.mark.asyncio
async def test_parse_chunk_prompt_includes_emotions_and_known_names(tmp_path):
    er.save(
        er.EntityRegistry(episode_id="ep1", characters=[{"canonical": "Tư An", "aliases": []}]),
        tmp_path,
        now="2026-06-04T00:00:00Z",
    )
    captured = {}

    def capture(*args, **kwargs):
        captured["payload"] = kwargs.get("json")
        return _make_mock_response(json.dumps({"chunk_id": "C001", "scenes": []}))

    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=capture)
        MockClient.return_value = instance
        await parse_chunk("C001", "text", "ep1", tmp_path)

    prompt = captured["payload"]["messages"][0]["content"]
    assert "commanding" in prompt
    assert "narration" in prompt
    assert "Tư An" in prompt


@pytest.mark.asyncio
async def test_reparse_scene_normalizes_and_forces_id(tmp_path):
    from animatory.scene_parser import reparse_scene
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
    )
    returned = {
        "scene_id": "WRONG_ID",  # model returns the wrong id — must be forced back
        "location": "Hall", "shot_type": "wide", "mood": "tense",
        "beats": [
            {"type": "narration", "start_anchor": "đại cản ra lệnh:", "end_anchor": "đại cản ra lệnh:"},
            {"type": "dialogue", "start_anchor": '"Quỳ."', "end_anchor": '"Quỳ."',
             "speaker": "đại cản", "speaker_cue": "đại cản ra lệnh",
             "speaker_confidence": "high", "emotion": "commanding"},
        ],
    }
    chunk_text = 'Mo dau chuong. đại cản ra lệnh: "Quỳ." Roi im lang.'
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(returned)))
        MockClient.return_value = instance
        scene = await reparse_scene(
            chunk_id="C001", chunk_text=chunk_text,
            anchor_scene={"scene_id": "C001_S02", "action": "old action"},
            registry=reg, scene_id="C001_S02",
        )
    assert scene["scene_id"] == "C001_S02"            # forced to requested id
    assert scene["characters"] == ["Đại Càn"]          # normalized
    assert scene["dialogue"][0]["character"] == "Đại Càn"
    assert scene["dialogue"][0]["line"] == '"Quỳ."'    # lifted verbatim
    assert scene["dialogue"][0]["emotion"] == "commanding"
    assert len(reg.characters) == 1                     # NOT grown (no learn)
    assert not (tmp_path / "entities.json").exists()    # no registry save


@pytest.mark.asyncio
async def test_reparse_scene_handles_scenes_wrapper():
    from animatory.scene_parser import reparse_scene
    reg = er.EntityRegistry(episode_id="ep1")
    wrapped = {"scenes": [{
        "scene_id": "x", "location": "L", "shot_type": "wide", "mood": "m",
        "beats": [{"type": "narration", "start_anchor": "Canh nay", "end_anchor": "o day."}],
    }]}
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(wrapped)))
        MockClient.return_value = instance
        scene = await reparse_scene(
            chunk_id="C001", chunk_text="Canh nay xay ra o day.",
            anchor_scene={"scene_id": "C001_S01"}, registry=reg, scene_id="C001_S01",
        )
    assert scene["scene_id"] == "C001_S01"
    assert scene["location"] == "L"
    assert scene["narration"] == ["Canh nay xay ra o day."]


@pytest.mark.asyncio
async def test_reparse_scene_prompt_has_anchor_and_known_names():
    from animatory.scene_parser import reparse_scene
    reg = er.EntityRegistry(episode_id="ep1", characters=[{"canonical": "Tư An", "aliases": []}])
    captured = {}

    def capture(*args, **kwargs):
        captured["payload"] = kwargs.get("json")
        return _make_mock_response(json.dumps({
            "scene_id": "C001_S01", "location": "L", "characters": [],
            "shot_type": "wide", "action": "a", "dialogue": [], "narration": [], "mood": "m",
        }))

    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=capture)
        MockClient.return_value = instance
        await reparse_scene(
            chunk_id="C001", chunk_text="the full chapter body",
            anchor_scene={"scene_id": "C001_S01", "action": "ANCHOR_MARKER"},
            registry=reg, scene_id="C001_S01",
        )

    prompt = captured["payload"]["messages"][0]["content"]
    assert "ANCHOR_MARKER" in prompt
    assert "Tư An" in prompt
    assert "the full chapter body" in prompt
    assert "commanding" in prompt


# ── two-phase (segment → extract) ────────────────────────────────────────────

def test_slice_by_anchors_cuts_consecutive_slices():
    text = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota."
    segments = [
        {"start_anchor": "Alpha beta"},
        {"start_anchor": "Delta epsilon"},
        {"start_anchor": "Eta theta"},
    ]
    slices = [s for _, s in _slice_by_anchors(text, segments)]
    assert len(slices) == 3
    assert slices[0].startswith("Alpha beta") and "gamma" in slices[0]
    assert slices[1].startswith("Delta epsilon") and "zeta" in slices[1]
    assert slices[2].startswith("Eta theta") and "iota" in slices[2]


def test_slice_by_anchors_tolerates_missing_anchor():
    text = "One two three four five six."
    segments = [{"start_anchor": "One two"}, {"start_anchor": "NOT IN TEXT"}]
    # Must not raise; still returns usable slices.
    pairs = _slice_by_anchors(text, segments)
    assert pairs and all(s for _, s in pairs)


def _beats_scene(start_anchor, end_anchor, *, btype="narration", **extra):
    """A one-beat locator response (the new phase-2 contract)."""
    beat = {"type": btype, "start_anchor": start_anchor, "end_anchor": end_anchor, **extra}
    return {"location": "L", "shot_type": "wide", "mood": "m", "beats": [beat]}


@pytest.mark.asyncio
async def test_two_phase_parse(tmp_path, monkeypatch):
    monkeypatch.setenv("QWEN_TWO_PHASE", "1")
    SEG = {"segments": [
        {"scene_id": "C001_S01", "location": "Quán", "characters": ["A"], "start_anchor": "Alpha mo dau"},
        {"scene_id": "C001_S02", "location": "Pho", "characters": ["B"], "start_anchor": "Bravo tiep theo"},
    ]}
    calls = []

    async def fake_call(prompt, *, label, **kw):
        calls.append(label)
        if label.endswith("/segment"):
            return SEG
        if label.endswith("S01"):
            return _beats_scene("Alpha mo dau", "canh mot.")
        return _beats_scene("Bravo tiep theo", "canh hai.")

    text = "Alpha mo dau canh mot. Bravo tiep theo canh hai."
    with patch("animatory.scene_parser._call_qwen", side_effect=fake_call):
        out = await parse_chunk("C001", text, "ep", tmp_path)

    data = json.loads(out.read_text(encoding="utf-8"))
    assert [s["scene_id"] for s in data["scenes"]] == ["C001_S01", "C001_S02"]
    # narration is lifted verbatim from each scene's own slice
    assert data["scenes"][0]["narration"] == ["Alpha mo dau canh mot."]
    assert data["scenes"][1]["narration"] == ["Bravo tiep theo canh hai."]
    assert sum(1 for c in calls if c.endswith("/segment")) == 1   # one segment call
    assert sum(1 for c in calls if not c.endswith("/segment")) == 2  # one extract per scene


@pytest.mark.asyncio
async def test_two_phase_falls_back_to_single_pass(tmp_path, monkeypatch):
    monkeypatch.setenv("QWEN_TWO_PHASE", "1")

    async def fake_call(prompt, *, label, **kw):
        if label.endswith("/segment"):
            return {"segments": []}            # segmentation yields nothing
        return {"scenes": [{"scene_id": "C001_S01", **_beats_scene("Mot canh", "o day.")}]}

    with patch("animatory.scene_parser._call_qwen", side_effect=fake_call):
        out = await parse_chunk("C001", "Mot canh don gian o day.", "ep", tmp_path)

    data = json.loads(out.read_text(encoding="utf-8"))
    assert len(data["scenes"]) == 1
    assert data["scenes"][0]["narration"] == ["Mot canh don gian o day."]
