# Scene Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Chapter page into a clean → parse → refine workspace: clean the raw chunk text with a local-LLM chat (highlighted find→replace corrections), parse/re-parse in place, and edit scenes manually or via LLM proposals — all persisted to separate edited copies.

**Architecture:** New backend module `animatory/scene_refiner.py` (Qwen chat, two modes) + new/modified routes in `animatory/pipeline_router.py` that persist `{cid}.edited.txt` and `{cid}_scenes.edited.json`, prefer them on read, and make parsing use the edited text. Frontend adds pipeline-API functions and three components (`RawTextEditor`, `EditableSceneCard`, `RefineChat`) wired together by a rewritten `ChapterView`.

**Tech Stack:** Python 3.11 / FastAPI / httpx / pytest (backend); React 18 / TypeScript / Tailwind / Vitest (frontend).

**Spec:** [`docs/superpowers/specs/2026-06-04-scene-refinement-design.md`](../specs/2026-06-04-scene-refinement-design.md)

---

## File Structure

**Backend**
- Create `animatory/scene_refiner.py` — `proofread_text()` + `refine_scenes()` (Qwen chat → JSON).
- Modify `animatory/scene_parser.py` — resolve edited chunk text in `parse_episode`.
- Modify `animatory/pipeline_router.py` — edited-copy helpers; text save/reset; scene save/reset; `/refine`; prefer-edited on `GET text`/`GET scenes`; `_episode_chunks` prefers edited scenes.
- Create `tests/test_scene_refiner.py`; extend `tests/test_pipeline_api.py`; extend `tests/test_scene_parser.py`.

**Frontend**
- Modify `frontend/src/api/pipeline.ts` — types + `saveText`, `resetText`, `saveScenes`, `resetScenes`, `refineChat`; `edited` on `ChunkText`/`ChunkScenes`.
- Create `frontend/src/components/refine/corrections.ts` — pure correction-apply helpers.
- Create `frontend/src/components/refine/RawTextEditor.tsx`.
- Create `frontend/src/components/refine/EditableSceneCard.tsx`.
- Create `frontend/src/components/refine/RefineChat.tsx`.
- Rewrite `frontend/src/studio/views/ChapterView.tsx` — owns state, layout, wiring.
- Create `frontend/src/api/pipeline.test.ts`; `frontend/src/components/refine/corrections.test.ts`.

**Conventions to follow:** backend tests use the `client` fixture from `tests/conftest.py` and `monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))`; LLM calls are mocked (never hit a live Qwen). Frontend API calls go through `frontend/src/api/pipeline.ts` only; one accent `#3772cf`; Tailwind tokens only.

---

## Task 1: `scene_refiner.py` — `proofread_text` (text mode)

**Files:**
- Create: `animatory/scene_refiner.py`
- Test: `tests/test_scene_refiner.py`

- [ ] **Step 1: Write the failing test**

```python
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


def _patch_client(content):
    """Return a context manager patching httpx.AsyncClient to return `content`."""
    p = patch("animatory.scene_refiner.httpx.AsyncClient")
    return p


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_refiner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'animatory.scene_refiner'`

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/scene_refiner.py
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)

_TEXT_SYSTEM = """\
You are a meticulous Vietnamese proofreader preparing a novel chapter for
animation shot-list extraction. Scan the chapter for typos and for incorrect or
inconsistent character names. Reply to the user, then return corrections as
find/replace edits. Return ONLY valid JSON matching this schema - no markdown:

{
  "reply": "short answer to the user",
  "corrections": [
    {"find": "exact substring in the text", "replace": "corrected substring",
     "rationale": "why", "all_occurrences": true}
  ]
}
The "find" value MUST be an exact substring of the chapter text."""


def _strip(raw: str) -> str:
    cleaned = _THINKING_RE.sub("", raw).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned


async def _chat_json(system: str, user_content: str, messages: list[dict],
                     qwen_endpoint, model, max_retries) -> dict:
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))
    enable_thinking = os.environ.get("QWEN_ENABLE_THINKING", "0") == "1"

    chat = (
        [{"role": "system", "content": system}]
        + [{"role": "system", "content": user_content}]
        + [{"role": m["role"], "content": m["content"]} for m in messages]
    )
    payload = {
        "model": model_name,
        "messages": chat,
        "temperature": 0.2,
        "chat_template_kwargs": {"enable_thinking": enable_thinking},
    }

    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        if attempt > 1:
            await asyncio.sleep(2 ** (attempt - 1))
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(f"{endpoint}/v1/chat/completions", json=payload)
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                return json.loads(_strip(raw))
        except httpx.HTTPError as exc:
            logger.warning("[refiner] attempt %d/%d: cannot reach Qwen at %s -> %s",
                           attempt, retries, endpoint, repr(exc))
            last_exc = exc
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("[refiner] attempt %d/%d: invalid response -> %s",
                           attempt, retries, repr(exc))
            last_exc = exc
    reason = (f"could not reach Qwen endpoint {endpoint}/v1/chat/completions"
              if isinstance(last_exc, httpx.HTTPError)
              else "could not parse JSON from Qwen response")
    raise ValueError(f"{reason} after {retries} attempts "
                     f"(last error: {type(last_exc).__name__}: {last_exc})") from last_exc


async def proofread_text(chunk_id, chunk_text, messages, *,
                         qwen_endpoint=None, model=None, max_retries=None) -> dict:
    """Return {"reply": str, "corrections": [ ... ]} from the proofreading chat."""
    user_content = f"Chapter {chunk_id} text:\n---\n{chunk_text}\n---"
    out = await _chat_json(_TEXT_SYSTEM, user_content, messages,
                           qwen_endpoint, model, max_retries)
    return {"reply": out.get("reply", ""), "corrections": out.get("corrections", [])}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_refiner.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_refiner.py tests/test_scene_refiner.py
git commit -m "feat(refiner): add proofread_text Qwen chat for raw-text corrections"
```

---

## Task 2: `scene_refiner.py` — `refine_scenes` (scenes mode)

**Files:**
- Modify: `animatory/scene_refiner.py`
- Test: `tests/test_scene_refiner.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scene_refiner.py  (append)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_refiner.py -v`
Expected: FAIL — `ImportError: cannot import name 'refine_scenes'`

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/scene_refiner.py  (append)
_SCENES_SYSTEM = """\
You are a Vietnamese novel-to-animation production assistant refining an existing
shot list. Reply to the user, then propose edits to EXISTING scenes only (do not
add or remove scenes). Return ONLY valid JSON matching this schema - no markdown:

{
  "reply": "short answer to the user",
  "proposals": [
    {"scene_id": "<existing scene_id>",
     "changes": {"location": "...", "characters": ["..."], "shot_type": "...",
                 "action": "...", "mood": "...",
                 "dialogue": [{"character": "...", "line": "..."}]},
     "rationale": "why"}
  ]
}
Include in "changes" ONLY the fields you want to alter."""


async def refine_scenes(chunk_id, chunk_text, scenes, messages, *,
                        qwen_endpoint=None, model=None, max_retries=None) -> dict:
    """Return {"reply": str, "proposals": [ ... ]} from the scene-refine chat."""
    user_content = (
        f"Chapter {chunk_id} text:\n---\n{chunk_text}\n---\n\n"
        f"Current scenes JSON:\n{json.dumps(scenes, ensure_ascii=False)}"
    )
    out = await _chat_json(_SCENES_SYSTEM, user_content, messages,
                           qwen_endpoint, model, max_retries)
    return {"reply": out.get("reply", ""), "proposals": out.get("proposals", [])}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_refiner.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_refiner.py tests/test_scene_refiner.py
git commit -m "feat(refiner): add refine_scenes Qwen chat for scene proposals"
```

---

## Task 3: Parse uses edited text

**Files:**
- Modify: `animatory/scene_parser.py` (the per-chunk read loop in `parse_episode`, ~line 169)
- Test: `tests/test_scene_parser.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scene_parser.py  (append)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_parser.py::test_parse_episode_prefers_edited_text -v`
Expected: FAIL — `assert 'original text.' == 'cleaned text.'`

- [ ] **Step 3: Write minimal implementation**

In `animatory/scene_parser.py`, replace these two lines inside the `for i, c in enumerate(...)` loop:

```python
        txt_path = episode_dir / c["file"]
        chunk_text = txt_path.read_text(encoding="utf-8")
```

with:

```python
        edited_path = episode_dir / f"{c['chunk_id']}.edited.txt"
        txt_path = edited_path if edited_path.exists() else episode_dir / c["file"]
        chunk_text = txt_path.read_text(encoding="utf-8")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_scene_parser.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_parser.py tests/test_scene_parser.py
git commit -m "feat(parser): parse from {chunk_id}.edited.txt when present"
```

---

## Task 4: Text routes — prefer-edited GET, PUT, DELETE

**Files:**
- Modify: `animatory/pipeline_router.py` (replace `get_chunk_text` ~line 243; add helpers + 2 routes)
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_api.py  (append)
async def _chunk_one(client, tmp_path, monkeypatch, ep):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": (f"{ep}.txt", io.BytesIO(TINY_TXT), "text/plain")}
    await client.post(f"/pipeline/chunk?episode_id={ep}", files=files)
    return (await client.get(f"/pipeline/episodes/{ep}/chunks")).json()["chunks"][0]["chunk_id"]


@pytest.mark.asyncio
async def test_save_and_get_edited_text(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "te1")

    r = await client.put(f"/pipeline/episodes/te1/chunks/{cid}/text",
                         json={"text": "cleaned chapter text"})
    assert r.status_code == 200
    assert r.json()["edited"] is True

    g = await client.get(f"/pipeline/episodes/te1/chunks/{cid}/text")
    assert g.json()["text"] == "cleaned chapter text"
    assert g.json()["edited"] is True


@pytest.mark.asyncio
async def test_reset_edited_text(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "te2")
    await client.put(f"/pipeline/episodes/te2/chunks/{cid}/text", json={"text": "edited"})

    d = await client.delete(f"/pipeline/episodes/te2/chunks/{cid}/text/edited")
    assert d.status_code == 200
    assert d.json()["edited"] is False

    g = await client.get(f"/pipeline/episodes/te2/chunks/{cid}/text")
    assert "Sentence one." in g.json()["text"]
    assert g.json()["edited"] is False


@pytest.mark.asyncio
async def test_put_text_unknown_chunk_404(client, tmp_path, monkeypatch):
    await _chunk_one(client, tmp_path, monkeypatch, "te3")
    r = await client.put("/pipeline/episodes/te3/chunks/C999/text", json={"text": "x"})
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py::test_save_and_get_edited_text -v`
Expected: FAIL — `405 Method Not Allowed` (no PUT route yet)

- [ ] **Step 3: Write minimal implementation**

In `animatory/pipeline_router.py`, add near the top helpers (after `_processed_dir`):

```python
def _chunk_meta(ep_dir: Path, chunk_id: str) -> dict:
    """Manifest entry for a chunk, or raise 404. Also 404s if not chunked."""
    manifest_path = ep_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail=f"Episode '{ep_dir.name}' not found or not chunked yet")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    meta = next((c for c in manifest.get("chunks", []) if c["chunk_id"] == chunk_id), None)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found in episode '{ep_dir.name}'")
    return meta


def _text_payload(ep_dir: Path, chunk_id: str, meta: dict) -> dict:
    edited = ep_dir / f"{chunk_id}.edited.txt"
    if edited.exists():
        text, is_edited = edited.read_text(encoding="utf-8"), True
    else:
        text, is_edited = (ep_dir / meta["file"]).read_text(encoding="utf-8"), False
    return {"chunk_id": chunk_id, "file": meta["file"],
            "word_count": meta.get("word_count"), "text": text, "edited": is_edited}
```

Replace the existing `get_chunk_text` body so it uses the helper and reports `edited`:

```python
@router.get("/episodes/{episode_id}/chunks/{chunk_id}/text")
async def get_chunk_text(episode_id: str, chunk_id: str):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    txt_path = ep_dir / meta["file"]
    if not txt_path.exists():
        raise HTTPException(status_code=404, detail=f"Text file for '{chunk_id}' is missing")
    return _text_payload(ep_dir, chunk_id, meta)
```

Add the two new routes after it:

```python
class SaveTextRequest(BaseModel):
    text: str


@router.put("/episodes/{episode_id}/chunks/{chunk_id}/text")
async def save_chunk_text(episode_id: str, chunk_id: str, body: SaveTextRequest):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    (ep_dir / f"{chunk_id}.edited.txt").write_text(body.text, encoding="utf-8")
    logger.info("[text] episode=%s chunk=%s saved edited text (%d chars)",
                episode_id, chunk_id, len(body.text))
    return _text_payload(ep_dir, chunk_id, meta)


@router.delete("/episodes/{episode_id}/chunks/{chunk_id}/text/edited")
async def reset_chunk_text(episode_id: str, chunk_id: str):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    edited = ep_dir / f"{chunk_id}.edited.txt"
    if edited.exists():
        edited.unlink()
    return _text_payload(ep_dir, chunk_id, meta)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py -k text -v`
Expected: PASS (existing text tests + 3 new)

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(pipeline): edited-text save/reset routes + prefer-edited GET text"
```

---

## Task 5: Scene routes — prefer-edited GET, PUT, DELETE; listing reflects edits

**Files:**
- Modify: `animatory/pipeline_router.py` (replace `get_chunk_scenes` ~line 217; update `_episode_chunks` ~line 169; add 2 routes)
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_api.py  (append)
def _scene(cid, n="01", mood="calm"):
    return {"scene_id": f"{cid}_S{n}", "location": "x", "characters": ["A"],
            "shot_type": "wide", "action": "act", "dialogue": [], "mood": mood}


async def _parse_one(client, tmp_path, cid, ep):
    # Simulate a completed parse by writing the original scenes file.
    doc = {"chunk_id": cid, "source_file": f"{ep}.txt", "model": "qwen3.5",
           "parsed_at": "2026-06-02T10:00:00Z", "scenes": [_scene(cid)]}
    (tmp_path / ep / f"{cid}_scenes.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")


@pytest.mark.asyncio
async def test_save_and_get_edited_scenes(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se1")
    await _parse_one(client, tmp_path, cid, "se1")

    r = await client.put(f"/pipeline/episodes/se1/chunks/{cid}/scenes",
                         json={"scenes": [_scene(cid, mood="ominous")]})
    assert r.status_code == 200
    assert r.json()["edited"] is True

    g = await client.get(f"/pipeline/episodes/se1/chunks/{cid}/scenes")
    assert g.json()["edited"] is True
    assert g.json()["scenes"][0]["mood"] == "ominous"


@pytest.mark.asyncio
async def test_put_scenes_unparsed_404(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se2")
    r = await client.put(f"/pipeline/episodes/se2/chunks/{cid}/scenes",
                         json={"scenes": [_scene(cid)]})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_put_scenes_invalid_body_422(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se3")
    await _parse_one(client, tmp_path, cid, "se3")
    r = await client.put(f"/pipeline/episodes/se3/chunks/{cid}/scenes",
                         json={"scenes": [{"scene_id": "x"}]})  # missing required fields
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_reset_edited_scenes(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se4")
    await _parse_one(client, tmp_path, cid, "se4")
    await client.put(f"/pipeline/episodes/se4/chunks/{cid}/scenes",
                    json={"scenes": [_scene(cid, mood="ominous")]})

    d = await client.delete(f"/pipeline/episodes/se4/chunks/{cid}/scenes/edited")
    assert d.status_code == 200
    assert d.json()["edited"] is False
    assert d.json()["scenes"][0]["mood"] == "calm"


@pytest.mark.asyncio
async def test_chunks_listing_reflects_edited_scene_count(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "se5")
    await _parse_one(client, tmp_path, cid, "se5")  # 1 scene original
    await client.put(f"/pipeline/episodes/se5/chunks/{cid}/scenes",
                    json={"scenes": [_scene(cid), _scene(cid, n="02")]})  # 2 edited

    chunks = (await client.get("/pipeline/episodes/se5/chunks")).json()["chunks"]
    row = next(c for c in chunks if c["chunk_id"] == cid)
    assert row["scene_count"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py::test_save_and_get_edited_scenes -v`
Expected: FAIL — `405 Method Not Allowed`

- [ ] **Step 3: Write minimal implementation**

In `animatory/pipeline_router.py`, add Pydantic models near `ParseRequest`:

```python
class SceneDialogueModel(BaseModel):
    character: str
    line: str


class SceneModel(BaseModel):
    scene_id: str
    location: str
    characters: list[str]
    shot_type: str
    action: str
    dialogue: list[SceneDialogueModel]
    mood: str


class SaveScenesRequest(BaseModel):
    scenes: list[SceneModel]
```

Add a scenes-payload helper near `_text_payload`:

```python
def _scenes_payload(ep_dir: Path, chunk_id: str) -> dict | None:
    """Edited scenes doc if present, else original, else None (not parsed)."""
    edited = ep_dir / f"{chunk_id}_scenes.edited.json"
    original = ep_dir / f"{chunk_id}_scenes.json"
    if edited.exists():
        doc, is_edited = json.loads(edited.read_text(encoding="utf-8")), True
    elif original.exists():
        doc, is_edited = json.loads(original.read_text(encoding="utf-8")), False
    else:
        return None
    doc["edited"] = is_edited
    return doc
```

Replace the `get_chunk_scenes` body to use it (preserves the 404/409 contract):

```python
@router.get("/episodes/{episode_id}/chunks/{chunk_id}/scenes")
async def get_chunk_scenes(episode_id: str, chunk_id: str):
    ep_dir = _processed_dir() / episode_id
    _chunk_meta(ep_dir, chunk_id)  # 404 if episode/chunk unknown
    doc = _scenes_payload(ep_dir, chunk_id)
    if doc is None:
        raise HTTPException(status_code=409, detail=f"Chunk '{chunk_id}' has not been parsed yet")
    return doc
```

Add the two new routes after it:

```python
@router.put("/episodes/{episode_id}/chunks/{chunk_id}/scenes")
async def save_chunk_scenes(episode_id: str, chunk_id: str, body: SaveScenesRequest):
    ep_dir = _processed_dir() / episode_id
    _chunk_meta(ep_dir, chunk_id)
    original = ep_dir / f"{chunk_id}_scenes.json"
    if not original.exists():
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' has not been parsed yet")
    base = json.loads(original.read_text(encoding="utf-8"))
    doc = {
        "chunk_id": chunk_id,
        "source_file": base.get("source_file", f"{episode_id}.txt"),
        "model": base.get("model", "manual"),
        "parsed_at": base.get("parsed_at"),
        "edited_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scenes": [s.model_dump() for s in body.scenes],
    }
    (ep_dir / f"{chunk_id}_scenes.edited.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[scenes] episode=%s chunk=%s saved %d edited scene(s)",
                episode_id, chunk_id, len(doc["scenes"]))
    return _scenes_payload(ep_dir, chunk_id)


@router.delete("/episodes/{episode_id}/chunks/{chunk_id}/scenes/edited")
async def reset_chunk_scenes(episode_id: str, chunk_id: str):
    ep_dir = _processed_dir() / episode_id
    _chunk_meta(ep_dir, chunk_id)
    edited = ep_dir / f"{chunk_id}_scenes.edited.json"
    if edited.exists():
        edited.unlink()
    doc = _scenes_payload(ep_dir, chunk_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' has not been parsed yet")
    return doc
```

In `_episode_chunks`, make `parsed`/`scene_count` prefer the edited copy. Replace the loop body's scene-file lines:

```python
        scenes_path = ep_dir / f"{c['chunk_id']}_scenes.json"
        parsed = scenes_path.exists()
        scene_count: int | None = None
        if parsed:
            parsed_count += 1
            try:
                scene_count = len(json.loads(scenes_path.read_text(encoding="utf-8")).get("scenes", []))
            except (json.JSONDecodeError, OSError):
                scene_count = None
```

with:

```python
        edited_path = ep_dir / f"{c['chunk_id']}_scenes.edited.json"
        original_path = ep_dir / f"{c['chunk_id']}_scenes.json"
        parsed = original_path.exists()
        scenes_path = edited_path if edited_path.exists() else original_path
        scene_count: int | None = None
        if parsed:
            parsed_count += 1
            try:
                scene_count = len(json.loads(scenes_path.read_text(encoding="utf-8")).get("scenes", []))
            except (json.JSONDecodeError, OSError):
                scene_count = None
```

Confirm `import datetime` is present at the top of the file (it is).

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py -k scene -v`
Expected: PASS (existing scene tests + 5 new)

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(pipeline): edited-scenes save/reset routes + prefer-edited reads"
```

---

## Task 6: `/refine` route (text + scenes targets)

**Files:**
- Modify: `animatory/pipeline_router.py` (add route + import + request model)
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_api.py  (append)
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_refine_text_target(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf1")
    fake = {"reply": "ok", "corrections": [{"find": "a", "replace": "b",
            "rationale": "r", "all_occurrences": True}]}
    with patch("animatory.pipeline_router.proofread_text", new_callable=AsyncMock, return_value=fake):
        r = await client.post(f"/pipeline/episodes/rf1/chunks/{cid}/refine",
                              json={"messages": [{"role": "user", "content": "fix"}], "target": "text"})
    assert r.status_code == 200
    assert r.json()["corrections"][0]["replace"] == "b"


@pytest.mark.asyncio
async def test_refine_scenes_target(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf2")
    await _parse_one(client, tmp_path, cid, "rf2")
    fake = {"reply": "ok", "proposals": [{"scene_id": f"{cid}_S01",
            "changes": {"mood": "dark"}, "rationale": "r"}]}
    with patch("animatory.pipeline_router.refine_scenes", new_callable=AsyncMock, return_value=fake):
        r = await client.post(f"/pipeline/episodes/rf2/chunks/{cid}/refine",
                              json={"messages": [{"role": "user", "content": "darker"}], "target": "scenes"})
    assert r.status_code == 200
    assert r.json()["proposals"][0]["changes"]["mood"] == "dark"


@pytest.mark.asyncio
async def test_refine_scenes_target_unparsed_404(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf3")
    r = await client.post(f"/pipeline/episodes/rf3/chunks/{cid}/refine",
                          json={"messages": [{"role": "user", "content": "x"}], "target": "scenes"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_refine_llm_failure_502(client, tmp_path, monkeypatch):
    cid = await _chunk_one(client, tmp_path, monkeypatch, "rf4")
    with patch("animatory.pipeline_router.proofread_text", new_callable=AsyncMock,
               side_effect=ValueError("could not reach Qwen")):
        r = await client.post(f"/pipeline/episodes/rf4/chunks/{cid}/refine",
                              json={"messages": [{"role": "user", "content": "x"}], "target": "text"})
    assert r.status_code == 502
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py -k refine -v`
Expected: FAIL — `405 Method Not Allowed`

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `animatory/pipeline_router.py` (next to the `scene_parser` import):

```python
from animatory.scene_refiner import proofread_text, refine_scenes
```

Add request models near `SaveScenesRequest`:

```python
class ChatMessageModel(BaseModel):
    role: str
    content: str


class RefineRequest(BaseModel):
    messages: list[ChatMessageModel]
    target: str  # "text" | "scenes"
```

Add the route (near the other chunk routes):

```python
@router.post("/episodes/{episode_id}/chunks/{chunk_id}/refine")
async def refine_chunk(episode_id: str, chunk_id: str, body: RefineRequest):
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)
    text = _text_payload(ep_dir, chunk_id, meta)["text"]
    messages = [m.model_dump() for m in body.messages]
    try:
        if body.target == "scenes":
            doc = _scenes_payload(ep_dir, chunk_id)
            if doc is None:
                # Spec: refine on scenes requires a parsed chunk → 404 (not 409).
                raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' has not been parsed yet")
            return await refine_scenes(chunk_id, text, doc.get("scenes", []), messages)
        return await proofread_text(chunk_id, text, messages)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
```

One subtlety: `HTTPException` raised inside the `try` would be swallowed by the `except ValueError` only if it were a `ValueError` — it is not, so the 404 propagates correctly. Keep the `raise HTTPException(... 404 ...)` above the LLM calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_pipeline_api.py -k refine -v`
Expected: PASS (4 new tests)

- [ ] **Step 5: Run the full backend suite + commit**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -q`
Expected: PASS (no regressions)

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(pipeline): add /refine route for text + scenes chat targets"
```

---

## Task 7: Frontend pipeline API client

**Files:**
- Modify: `frontend/src/api/pipeline.ts`
- Test: `frontend/src/api/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/api/pipeline.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveText, refineChat, saveScenes } from './pipeline'

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('pipeline client', () => {
  it('saveText PUTs the text and returns the doc', async () => {
    const fetchMock = mockFetch({ chunk_id: 'C001', text: 'hi', edited: true })
    vi.stubGlobal('fetch', fetchMock)
    const res = await saveText('ep1', 'C001', 'hi')
    expect(res.edited).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/chunks/C001/text')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body).text).toBe('hi')
  })

  it('refineChat posts messages + target', async () => {
    const fetchMock = mockFetch({ reply: 'ok', corrections: [] })
    vi.stubGlobal('fetch', fetchMock)
    const res = await refineChat('ep1', 'C001', [{ role: 'user', content: 'x' }], 'text')
    expect(res.reply).toBe('ok')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body).target).toBe('text')
  })

  it('saveScenes throws on non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'bad' }, false, 422))
    await expect(saveScenes('ep1', 'C001', [])).rejects.toThrow(/422/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/pipeline.test.ts`
Expected: FAIL — `saveText is not exported` / type errors

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/api/pipeline.ts` and add `edited` to the two read interfaces:

In `ChunkScenes` add `edited: boolean`. In `ChunkText` add `edited: boolean`.

Then append:

```ts
export interface TextCorrection {
  find: string
  replace: string
  rationale: string
  all_occurrences: boolean
}

export interface ScenePatch {
  scene_id: string
  changes: Partial<Omit<PipelineScene, 'scene_id'>>
  rationale: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RefineResult {
  reply: string
  corrections?: TextCorrection[]
  proposals?: ScenePatch[]
}

function chunkBase(episodeId: string, chunkId: string): string {
  return `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}`
}

async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${label} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function saveText(episodeId: string, chunkId: string, text: string): Promise<ChunkText> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/text`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return jsonOrThrow<ChunkText>(res, 'saveText')
}

export async function resetText(episodeId: string, chunkId: string): Promise<ChunkText> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/text/edited`, { method: 'DELETE' })
  return jsonOrThrow<ChunkText>(res, 'resetText')
}

export async function saveScenes(
  episodeId: string, chunkId: string, scenes: PipelineScene[],
): Promise<ChunkScenes> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/scenes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenes }),
  })
  return jsonOrThrow<ChunkScenes>(res, 'saveScenes')
}

export async function resetScenes(episodeId: string, chunkId: string): Promise<ChunkScenes> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/scenes/edited`, { method: 'DELETE' })
  return jsonOrThrow<ChunkScenes>(res, 'resetScenes')
}

export async function refineChat(
  episodeId: string, chunkId: string, messages: ChatMessage[], target: 'text' | 'scenes',
): Promise<RefineResult> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, target }),
  })
  return jsonOrThrow<RefineResult>(res, 'refineChat')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/pipeline.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/pipeline.ts frontend/src/api/pipeline.test.ts
git commit -m "feat(frontend): pipeline API client for text/scenes edit + refine chat"
```

---

## Task 8: Correction-apply helper (pure)

**Files:**
- Create: `frontend/src/components/refine/corrections.ts`
- Test: `frontend/src/components/refine/corrections.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/components/refine/corrections.test.ts
import { describe, it, expect } from 'vitest'
import { applyCorrection, correctionMatches } from './corrections'

describe('corrections', () => {
  it('replaces first occurrence when all_occurrences is false', () => {
    const out = applyCorrection('teh cat teh dog', { find: 'teh', replace: 'the', rationale: '', all_occurrences: false })
    expect(out).toBe('the cat teh dog')
  })

  it('replaces every occurrence when all_occurrences is true', () => {
    const out = applyCorrection('Tú Ân and Tú Ân', { find: 'Tú Ân', replace: 'Tú An', rationale: '', all_occurrences: true })
    expect(out).toBe('Tú An and Tú An')
  })

  it('correctionMatches is false when find is absent', () => {
    expect(correctionMatches('hello', { find: 'xyz', replace: '', rationale: '', all_occurrences: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/refine/corrections.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/components/refine/corrections.ts
import type { TextCorrection } from '../../api/pipeline'

/** True if the correction's `find` still appears in the text. */
export function correctionMatches(text: string, c: TextCorrection): boolean {
  return c.find.length > 0 && text.includes(c.find)
}

/** Apply one correction to the text (first or all occurrences). Plain string
 *  replacement — `find` is treated literally, never as a regex. */
export function applyCorrection(text: string, c: TextCorrection): string {
  if (!correctionMatches(text, c)) return text
  if (c.all_occurrences) return text.split(c.find).join(c.replace)
  return text.replace(c.find, c.replace)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/refine/corrections.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/refine/corrections.ts frontend/src/components/refine/corrections.test.ts
git commit -m "feat(frontend): pure correction-apply helper for raw text"
```

---

## Task 9: `RefineChat` component

**Files:**
- Create: `frontend/src/components/refine/RefineChat.tsx`

> Run the `ui-taste` skill before writing this JSX.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/refine/RefineChat.tsx
import { useState } from 'react'
import type { ChatMessage } from '../../api/pipeline'

interface Props {
  messages: ChatMessage[]
  target: 'text' | 'scenes'
  canTargetScenes: boolean
  sending: boolean
  error: string
  onSend: (text: string) => void
  onChangeTarget: (t: 'text' | 'scenes') => void
  onRetry: () => void
}

export function RefineChat({
  messages, target, canTargetScenes, sending, error, onSend, onChangeTarget, onRetry,
}: Props) {
  const [draft, setDraft] = useState('')

  function submit() {
    const text = draft.trim()
    if (!text || sending) return
    onSend(text)
    setDraft('')
  }

  return (
    <div className="flex flex-col h-full rounded-lg border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
        <h2 className="text-sm font-semibold text-ink">Refine</h2>
        <div className="flex rounded-full border border-hairline overflow-hidden text-[11px]">
          {(['text', 'scenes'] as const).map(t => {
            const disabled = t === 'scenes' && !canTargetScenes
            const active = target === t
            return (
              <button
                key={t}
                type="button"
                disabled={disabled || sending}
                onClick={() => onChangeTarget(t)}
                className={
                  'px-2.5 py-1 capitalize transition-colors disabled:opacity-40 ' +
                  (active ? 'bg-[#3772cf] text-white' : 'text-steel hover:text-ink')
                }
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <p className="text-xs text-stone leading-relaxed">
            {target === 'text'
              ? 'Ask me to scan for typos or fix a character’s name across the chapter.'
              : 'Ask me to refine these scenes — e.g. “make scene 3 darker”.'}
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user' ? 'text-right' : 'text-left'}
            >
              <span
                className={
                  'inline-block rounded-md px-3 py-2 text-xs leading-snug max-w-[85%] text-left ' +
                  (m.role === 'user'
                    ? 'bg-[#3772cf] text-white'
                    : 'bg-surface text-ink border border-hairline')
                }
              >
                {m.content}
              </span>
            </div>
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-steel">
            <Spinner /> Thinking…
          </div>
        )}
        {error && (
          <div className="text-xs text-brand-error">
            {error}{' '}
            <button onClick={onRetry} className="underline hover:text-ink">Retry</button>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
            rows={2}
            placeholder={target === 'text' ? 'Ask to fix text…' : 'Ask to refine scenes…'}
            className="flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-[#3772cf]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || sending}
            className="px-3 py-2 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 animate-spin text-[#3772cf]" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/RefineChat.tsx
git commit -m "feat(frontend): RefineChat sidebar with target switch + states"
```

---

## Task 10: `EditableSceneCard` component

**Files:**
- Create: `frontend/src/components/refine/EditableSceneCard.tsx`

> Run the `ui-taste` skill before writing this JSX. Read mode must visually match the existing card in `frontend/src/components/SceneList.tsx`.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/refine/EditableSceneCard.tsx
import { useState } from 'react'
import type { PipelineScene, ScenePatch } from '../../api/pipeline'

const SHOT_TYPES = ['wide', 'medium', 'close-up', 'insert', 'POV']

interface Props {
  scene: PipelineScene
  isEditing: boolean
  proposal?: ScenePatch
  onEdit: () => void
  onCancel: () => void
  onSaveLocal: (next: PipelineScene) => void
  onAcceptProposal: () => void
  onRejectProposal: () => void
}

export function EditableSceneCard({
  scene, isEditing, proposal, onEdit, onCancel, onSaveLocal, onAcceptProposal, onRejectProposal,
}: Props) {
  if (isEditing) return <EditForm scene={scene} onCancel={onCancel} onSave={onSaveLocal} />

  const tags = [scene.location, scene.characters.join(', '), scene.mood].filter(Boolean)

  return (
    <div className="bg-canvas border border-hairline rounded-md p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-stone">
          {sceneLabel(scene.scene_id)}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {scene.shot_type && (
            <span className="font-mono text-[11px] uppercase tracking-wide text-[#3772cf]">
              {scene.shot_type}
            </span>
          )}
          <button onClick={onEdit} className="text-[11px] text-steel hover:text-ink">Edit</button>
        </div>
      </div>

      {scene.action && (
        <p className="text-sm font-medium text-ink leading-snug mb-2.5">{scene.action}</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 last:mb-0">
          {tags.map((t, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline">
              {t}
            </span>
          ))}
        </div>
      )}

      {scene.dialogue.length > 0 && (
        <dl className="space-y-1 border-t border-hairline pt-2.5">
          {scene.dialogue.map((d, i) => (
            <div key={i} className="flex gap-2 text-xs leading-snug">
              <dt className="font-medium text-steel shrink-0">{d.character}</dt>
              <dd className="text-ink">{d.line}</dd>
            </div>
          ))}
        </dl>
      )}

      {proposal && (
        <div className="mt-3 rounded-md border border-[#3772cf]/40 bg-[#3772cf]/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#3772cf] mb-1.5">Suggested</div>
          <dl className="space-y-1 mb-2">
            {Object.entries(proposal.changes).map(([k, v]) => (
              <div key={k} className="text-xs">
                <span className="text-stone">{k}: </span>
                <span className="text-ink">{Array.isArray(v) ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </dl>
          {proposal.rationale && <p className="text-[11px] text-steel mb-2">{proposal.rationale}</p>}
          <div className="flex gap-2">
            <button onClick={onAcceptProposal} className="px-2.5 py-1 rounded-md bg-[#3772cf] text-white text-[11px] font-medium hover:bg-[#2c5cab]">Accept</button>
            <button onClick={onRejectProposal} className="px-2.5 py-1 rounded-md border border-hairline text-steel text-[11px] hover:bg-surface">Reject</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditForm({ scene, onCancel, onSave }: {
  scene: PipelineScene; onCancel: () => void; onSave: (s: PipelineScene) => void
}) {
  const [draft, setDraft] = useState<PipelineScene>(scene)
  const set = (patch: Partial<PipelineScene>) => setDraft(d => ({ ...d, ...patch }))
  const field = 'w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-[#3772cf]'

  return (
    <div className="bg-canvas border border-[#3772cf]/40 rounded-md p-4 space-y-2.5">
      <div className="font-mono text-[11px] uppercase tracking-wide text-stone">{sceneLabel(scene.scene_id)}</div>
      <textarea className={field} rows={2} value={draft.action} onChange={e => set({ action: e.target.value })} placeholder="Action" />
      <div className="grid grid-cols-2 gap-2">
        <input className={field} value={draft.location} onChange={e => set({ location: e.target.value })} placeholder="Location" />
        <select className={field} value={draft.shot_type} onChange={e => set({ shot_type: e.target.value })}>
          {SHOT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className={field} value={draft.characters.join(', ')} onChange={e => set({ characters: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Characters (comma-separated)" />
        <input className={field} value={draft.mood} onChange={e => set({ mood: e.target.value })} placeholder="Mood" />
      </div>

      <div className="space-y-1.5">
        {draft.dialogue.map((d, i) => (
          <div key={i} className="flex gap-1.5">
            <input className={field + ' w-1/3'} value={d.character} onChange={e => {
              const dl = [...draft.dialogue]; dl[i] = { ...dl[i], character: e.target.value }; set({ dialogue: dl })
            }} placeholder="Character" />
            <input className={field} value={d.line} onChange={e => {
              const dl = [...draft.dialogue]; dl[i] = { ...dl[i], line: e.target.value }; set({ dialogue: dl })
            }} placeholder="Line" />
            <button onClick={() => set({ dialogue: draft.dialogue.filter((_, j) => j !== i) })} className="text-stone hover:text-brand-error px-1" aria-label="Remove line">×</button>
          </div>
        ))}
        <button onClick={() => set({ dialogue: [...draft.dialogue, { character: '', line: '' }] })} className="text-[11px] text-steel hover:text-ink">+ Add dialogue line</button>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={() => onSave(draft)} className="px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab]">Save</button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md border border-hairline text-steel text-xs hover:bg-surface">Cancel</button>
      </div>
    </div>
  )
}

function sceneLabel(sceneId: string): string {
  const m = sceneId.match(/_S(\d+)$/)
  return m ? `Scene ${m[1]}` : sceneId
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/EditableSceneCard.tsx
git commit -m "feat(frontend): EditableSceneCard with edit form + proposal banner"
```

---

## Task 11: `RawTextEditor` component

**Files:**
- Create: `frontend/src/components/refine/RawTextEditor.tsx`

> Run the `ui-taste` skill before writing this JSX.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/refine/RawTextEditor.tsx
import { useState } from 'react'
import type { TextCorrection } from '../../api/pipeline'
import { correctionMatches } from './corrections'

interface Props {
  text: string
  edited: boolean
  dirty: boolean
  saving: boolean
  parsed: boolean
  parsing: boolean
  parseProgress: { done: number; total: number } | null
  corrections: TextCorrection[]
  onChange: (next: string) => void
  onAcceptCorrection: (c: TextCorrection) => void
  onRejectCorrection: (c: TextCorrection) => void
  onSave: () => void
  onReset: () => void
  onParse: () => void
}

export function RawTextEditor(props: Props) {
  const {
    text, edited, dirty, saving, parsed, parsing, parseProgress,
    corrections, onAcceptCorrection, onRejectCorrection, onChange, onSave, onReset, onParse,
  } = props
  const [editing, setEditing] = useState(false)

  const pct = parseProgress && parseProgress.total > 0
    ? Math.round((parseProgress.done / parseProgress.total) * 100) : 0

  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink">
          Raw text{edited && <span className="ml-2 text-[11px] font-normal text-[#3772cf]">✎ edited</span>}
        </h2>
        <button onClick={() => setEditing(e => !e)} className="text-xs text-steel hover:text-ink">
          {editing ? 'Done editing' : 'Edit text'}
        </button>
      </div>

      <div className="rounded-lg border border-hairline bg-canvas">
        {editing ? (
          <textarea
            value={text}
            onChange={e => onChange(e.target.value)}
            className="w-full max-h-80 min-h-[12rem] resize-y p-4 text-xs leading-relaxed text-steel bg-canvas font-mono focus:outline-none focus:ring-2 focus:ring-[#3772cf] rounded-lg"
          />
        ) : (
          <pre className="max-h-80 overflow-y-auto p-4 text-xs leading-relaxed text-steel whitespace-pre-wrap font-mono">
            {text}
          </pre>
        )}
      </div>

      {corrections.length > 0 && (
        <div className="mt-3 space-y-2">
          {corrections.map((c, i) => {
            const stale = !correctionMatches(text, c)
            return (
              <div key={i} className="flex items-start gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs">
                <div className="flex-1">
                  <span className="line-through text-stone">{c.find}</span>
                  <span className="mx-1.5 text-stone">→</span>
                  <span className="text-ink font-medium">{c.replace}</span>
                  {c.all_occurrences && <span className="ml-2 text-[11px] text-[#3772cf]">all</span>}
                  {c.rationale && <div className="text-[11px] text-steel mt-0.5">{c.rationale}</div>}
                  {stale && <div className="text-[11px] text-stone mt-0.5">no longer applies</div>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button disabled={stale} onClick={() => onAcceptCorrection(c)} className="px-2 py-0.5 rounded-md bg-[#3772cf] text-white text-[11px] disabled:opacity-40 hover:bg-[#2c5cab]">Accept</button>
                  <button onClick={() => onRejectCorrection(c)} className="px-2 py-0.5 rounded-md border border-hairline text-steel text-[11px] hover:bg-canvas">Reject</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-2.5 mt-3">
        {edited && (
          <button onClick={onReset} disabled={saving || parsing} className="text-xs text-steel hover:text-ink disabled:opacity-50">
            Reset text
          </button>
        )}
        {dirty && (
          <button onClick={onSave} disabled={saving} className="px-3 py-1.5 rounded-md border border-hairline text-steel text-xs hover:bg-surface disabled:opacity-50">
            {saving ? 'Saving…' : 'Save text ●'}
          </button>
        )}
        <button
          onClick={onParse}
          disabled={parsing}
          className="px-4 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {parsing ? `Parsing… ${pct}%` : parsed ? 'Re-parse' : 'Parse this chapter'}
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/RawTextEditor.tsx
git commit -m "feat(frontend): RawTextEditor with edit toggle, corrections, parse button"
```

---

## Task 12: Wire it all into `ChapterView`

**Files:**
- Modify (rewrite): `frontend/src/studio/views/ChapterView.tsx`

> Run the `ui-taste` skill before writing this JSX.

- [ ] **Step 1: Rewrite `ChapterView.tsx`**

```tsx
// frontend/src/studio/views/ChapterView.tsx
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getChunkScenes, getChunkText, parseEpisode, refineChat,
  saveScenes, saveText, resetScenes, resetText,
  type ChatMessage, type PipelineScene, type ScenePatch, type TextCorrection,
} from '../../api/pipeline'
import { api } from '../../api'
import { applyCorrection } from '../../components/refine/corrections'
import { RawTextEditor } from '../../components/refine/RawTextEditor'
import { EditableSceneCard } from '../../components/refine/EditableSceneCard'
import { RefineChat } from '../../components/refine/RefineChat'

export function ChapterView() {
  const { id = '', episodeId = '', chunkId = '' } = useParams()

  // Text state
  const [text, setText] = useState('')
  const [textBaseline, setTextBaseline] = useState('')
  const [textEdited, setTextEdited] = useState(false)
  const [textWordCount, setTextWordCount] = useState<number | null>(null)
  const [savingText, setSavingText] = useState(false)
  const [corrections, setCorrections] = useState<TextCorrection[]>([])

  // Scenes state
  const [scenes, setScenes] = useState<PipelineScene[]>([])
  const [sceneBaseline, setSceneBaseline] = useState('')
  const [scenesEdited, setScenesEdited] = useState(false)
  const [parsed, setParsed] = useState(false)
  const [editing, setEditing] = useState<Set<string>>(new Set())
  const [proposals, setProposals] = useState<Record<string, ScenePatch>>({})
  const [savingScenes, setSavingScenes] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [target, setTarget] = useState<'text' | 'scenes'>('text')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')

  // Page state
  const [loading, setLoading] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number } | null>(null)
  const [skipped, setSkipped] = useState(0)

  const textDirty = text !== textBaseline
  const scenesDirty = JSON.stringify(scenes) !== sceneBaseline

  const loadScenes = useCallback(async () => {
    try {
      const s = await getChunkScenes(episodeId, chunkId)
      setScenes(s.scenes)
      setSceneBaseline(JSON.stringify(s.scenes))
      setScenesEdited(s.edited)
      setParsed(true)
    } catch (e) {
      if (/\b409\b/.test(String(e))) setParsed(false)
      else throw e
    }
  }, [episodeId, chunkId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getChunkText(episodeId, chunkId)
      .then(t => {
        if (!alive) return
        setText(t.text); setTextBaseline(t.text); setTextEdited(t.edited)
        setTextWordCount(t.word_count)
      })
      .then(() => loadScenes())
      .catch(() => { /* surfaced via empty/error states below */ })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [episodeId, chunkId, loadScenes])

  // Auto-follow target with parse state (still user-switchable).
  useEffect(() => { setTarget(parsed ? 'scenes' : 'text') }, [parsed])

  // --- Text actions ---
  function acceptCorrection(c: TextCorrection) {
    setText(t => applyCorrection(t, c))
    setCorrections(cs => cs.filter(x => x !== c))
  }
  function rejectCorrection(c: TextCorrection) {
    setCorrections(cs => cs.filter(x => x !== c))
  }
  async function onSaveText() {
    setSavingText(true)
    try {
      const t = await saveText(episodeId, chunkId, text)
      setTextBaseline(t.text); setTextEdited(t.edited)
    } finally { setSavingText(false) }
  }
  async function onResetText() {
    if (!confirm('Discard your text edits and restore the original chapter text?')) return
    const t = await resetText(episodeId, chunkId)
    setText(t.text); setTextBaseline(t.text); setTextEdited(t.edited); setCorrections([])
  }

  // --- Parse ---
  async function onParse() {
    if (parsing) return
    if (parsed && !confirm('Re-parsing replaces the extracted scenes; saved scene edits will be discarded. Continue?')) return
    setParsing(true); setParseProgress(null)
    try {
      if (parsed && scenesEdited) await resetScenes(episodeId, chunkId).catch(() => {})
      const { run_id } = await parseEpisode(episodeId, [chunkId])
      const es = api.streamRun(run_id)
      es.addEventListener('message', (ev: Event) => {
        try {
          const event = JSON.parse((ev as MessageEvent).data as string)
          if (event.type === 'log') {
            const m = /\[(\d+)\/(\d+)\]/.exec(event.data.message)
            if (m) setParseProgress({ done: Number(m[1]), total: Number(m[2]) })
          }
          if (event.type === 'complete') {
            es.close(); setParsing(false); setParseProgress(null)
            setProposals({}); loadScenes()
          }
          if (event.data?.status === 'failed') {
            es.close(); setParsing(false); setParseProgress(null)
          }
        } catch { /* ignore */ }
      })
    } catch { setParsing(false); setParseProgress(null) }
  }

  // --- Scene actions ---
  function saveLocalScene(next: PipelineScene) {
    setScenes(ss => ss.map(s => (s.scene_id === next.scene_id ? next : s)))
    setEditing(prev => { const n = new Set(prev); n.delete(next.scene_id); return n })
  }
  function acceptProposal(p: ScenePatch) {
    setScenes(ss => ss.map(s => (s.scene_id === p.scene_id ? { ...s, ...p.changes } : s)))
    setProposals(prev => { const n = { ...prev }; delete n[p.scene_id]; return n })
  }
  function rejectProposal(sceneId: string) {
    setProposals(prev => { const n = { ...prev }; delete n[sceneId]; return n })
  }
  async function onSaveScenes() {
    setSavingScenes(true)
    try {
      const s = await saveScenes(episodeId, chunkId, scenes)
      setSceneBaseline(JSON.stringify(s.scenes)); setScenesEdited(s.edited)
    } finally { setSavingScenes(false) }
  }
  async function onResetScenes() {
    if (!confirm('Discard your scene edits and restore the original extraction?')) return
    const s = await resetScenes(episodeId, chunkId)
    setScenes(s.scenes); setSceneBaseline(JSON.stringify(s.scenes)); setScenesEdited(s.edited); setProposals({})
  }

  // --- Chat ---
  // Single send path: takes the full message list to POST. onSend appends the
  // user turn first; onRetry re-sends the existing list (the failed user turn is
  // still present, so nothing is re-appended) — avoids stale-closure bugs.
  async function sendMessages(msgs: ChatMessage[]) {
    setSending(true); setChatError(''); setSkipped(0)
    try {
      const res = await refineChat(episodeId, chunkId, msgs, target)
      setMessages([...msgs, { role: 'assistant', content: res.reply }])
      if (target === 'text' && res.corrections) {
        setCorrections(res.corrections)
      }
      if (target === 'scenes' && res.proposals) {
        const valid: Record<string, ScenePatch> = {}
        let skip = 0
        for (const p of res.proposals) {
          if (scenes.some(s => s.scene_id === p.scene_id)) valid[p.scene_id] = p
          else skip++
        }
        setProposals(valid); setSkipped(skip)
      }
    } catch (e) {
      setChatError(String(e))
    } finally { setSending(false) }
  }
  function onSend(content: string) {
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    sendMessages(next)
  }
  function onRetry() {
    if (messages.length > 0) sendMessages(messages)
  }

  return (
    <div className="max-w-6xl">
      <Link to={`/project/${id}/parse`} className="inline-flex items-center gap-1.5 text-xs text-steel hover:text-ink mb-4">
        ← Back to parsing
      </Link>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">{episodeId}</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">
        Chapter <span className="font-mono">{chunkId}</span>
      </h1>
      <p className="text-sm text-steel mt-1 mb-6">
        {textWordCount != null ? `${textWordCount.toLocaleString()} words` : 'Source text'}
        {parsed ? ` · ${scenes.length} scenes` : ''}
        {(textEdited || scenesEdited) ? ' · ✎ edited' : ''}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="min-w-0">
          <RawTextEditor
            text={text} edited={textEdited} dirty={textDirty} saving={savingText}
            parsed={parsed} parsing={parsing} parseProgress={parseProgress}
            corrections={corrections}
            onChange={setText}
            onAcceptCorrection={acceptCorrection} onRejectCorrection={rejectCorrection}
            onSave={onSaveText} onReset={onResetText} onParse={onParse}
          />

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-ink">Scenes</h2>
              {parsed && (
                <div className="flex items-center gap-2.5">
                  {scenesEdited && (
                    <button onClick={onResetScenes} className="text-xs text-steel hover:text-ink">Reset</button>
                  )}
                  <button onClick={onSaveScenes} disabled={!scenesDirty || savingScenes}
                    className="px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed">
                    {savingScenes ? 'Saving…' : scenesDirty ? 'Save changes ●' : 'Saved'}
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <p className="text-xs text-steel py-4">Loading…</p>
            ) : !parsed ? (
              <div className="rounded-lg border border-dashed border-hairline bg-canvas p-6 text-center text-sm text-steel">
                This chapter hasn’t been parsed yet.
                <div className="mt-1 text-xs text-stone">Use “Parse this chapter” above to extract scenes.</div>
              </div>
            ) : (
              <>
                {skipped > 0 && (
                  <div className="mb-2 text-[11px] text-stone">{skipped} suggestion(s) skipped (scene not found).</div>
                )}
                <div className="space-y-2.5">
                  {scenes.map(s => (
                    <EditableSceneCard
                      key={s.scene_id}
                      scene={s}
                      isEditing={editing.has(s.scene_id)}
                      proposal={proposals[s.scene_id]}
                      onEdit={() => setEditing(prev => new Set(prev).add(s.scene_id))}
                      onCancel={() => setEditing(prev => { const n = new Set(prev); n.delete(s.scene_id); return n })}
                      onSaveLocal={saveLocalScene}
                      onAcceptProposal={() => acceptProposal(proposals[s.scene_id])}
                      onRejectProposal={() => rejectProposal(s.scene_id)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-6 h-[70vh]">
          <RefineChat
            messages={messages} target={target} canTargetScenes={parsed}
            sending={sending} error={chatError}
            onSend={onSend} onChangeTarget={setTarget} onRetry={onRetry}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `cd frontend && npx tsc -b --noEmit && npm run build`
Expected: no errors; build succeeds

- [ ] **Step 3: Run the frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (all suites incl. new pipeline + corrections tests)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/studio/views/ChapterView.tsx
git commit -m "feat(frontend): ChapterView clean/parse/refine workspace"
```

---

## Task 13: ui-taste pass + live verification

**Files:** none (review + manual verification)

- [ ] **Step 1: Run the `ui-taste` skill** against the Chapter workspace (RawTextEditor, EditableSceneCard, RefineChat, ChapterView). Fix any smell-test failures (accent discipline, token-only values, loading/empty/error states, restrained motion).

- [ ] **Step 2: Start the stack and verify the flow.** With the backend running (`uvicorn animatory.server:app --reload --port 8000`), Qwen reachable at `:1090`, and the frontend (`cd frontend && npm run dev` with `VITE_API_BASE_URL` pointing at the backend), open a chunked-but-unparsed chapter and confirm, using the preview tools:
  - **Text mode chat** returns corrections; Accept (incl. "all") rewrites the text; Save → reload shows `✎ edited`; Reset restores original.
  - **Parse this chapter** runs (progress), scenes appear, the chat target flips to Scenes.
  - **Edit** a scene card, Save changes → `✎ edited`; **Scenes mode chat** proposal appears on the right card, Accept merges, Save persists; Reset restores.
  - **Re-parse** warns, regenerates scenes, clears stale edits.
  Capture a screenshot of the working two-column workspace as proof.

- [ ] **Step 3: Final full test run.**

Run: `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -q` and `cd frontend && npm test`
Expected: all green.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(refine): ui-taste fixes + verification"
```

---

## Notes for the implementer

- **LLM is always mocked in tests.** Never let a test reach a live Qwen server (it blocks the suite). Patch `animatory.scene_refiner.httpx.AsyncClient` (module tests) or `animatory.pipeline_router.proofread_text`/`refine_scenes` (route tests).
- **Drain background tasks** in any test that triggers `/pipeline/parse` while the parse mock is active — follow the existing `test_parse_endpoint_returns_run_id` pattern.
- **No mock path for pipeline routes in the frontend** — `pipeline.ts` always hits the real backend. The Chapter workspace therefore needs the live stack to exercise end-to-end; component-level correctness is covered by the pure `corrections` + API-client unit tests.
- **Explicit save everywhere:** accepting a correction or proposal, and manual edits, only mutate the working copy. Persisting requires the Save buttons. This matches the separate-edited-copy design.
