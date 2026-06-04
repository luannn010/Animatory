# Per-Scene Re-parse (Sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-scene "Re-parse" action that re-extracts one scene fresh from the chapter source (consulting + normalizing via the entity registry, without learning) and surfaces it as an accept/reject proposal on that scene's card.

**Architecture:** Refactor the Qwen call out of `parse_chunk` into a shared `_call_qwen` helper, add a `reparse_scene` function that re-extracts a single scene (whole chunk + the scene as anchor), expose it via a POST route that returns the normalized scene without persisting, and wire a Re-parse button → existing per-card proposal flow on the frontend.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 / httpx / pytest-asyncio (asyncio_mode=auto); React 18 / Vite / TypeScript / Tailwind 3 / Vitest (node env, fetch-mock — no DOM lib).

**Spec:** `docs/superpowers/specs/2026-06-04-per-scene-reparse-design.md`

**Branch:** `feat/per-scene-reparse` (already created).

---

## File Structure

**Backend**
- Modify `animatory/scene_parser.py` — extract `_qwen_env` + `_call_qwen`; refactor `parse_chunk` to use them; add `_REPARSE_TEMPLATE` + `reparse_scene`.
- Modify `animatory/pipeline_router.py` — import `reparse_scene`; add the per-scene reparse POST route.
- Extend `tests/test_scene_parser.py` (reparse_scene), `tests/test_pipeline_api.py` (route).

**Frontend**
- Modify `frontend/src/api/pipeline.ts` — add `reparseScene` client.
- Modify `frontend/src/components/refine/EditableSceneCard.tsx` — Re-parse button + `reparsing` state.
- Modify `frontend/src/studio/views/ChapterView.tsx` — reparsing set, handler, proposal + error wiring.
- Extend `frontend/src/api/pipeline.test.ts`.

---

## Task C-T1: Refactor — shared `_call_qwen` helper

Behaviour-preserving refactor: pull the Qwen request/retry/clean/parse logic out of `parse_chunk` so `reparse_scene` (C-T2) can reuse it. Existing `parse_chunk` tests must stay green (they assert the `"could not parse JSON"` message and patch `animatory.scene_parser.httpx.AsyncClient`).

**Files:**
- Modify: `animatory/scene_parser.py`
- Test: `tests/test_scene_parser.py` (existing tests are the regression guard — no new tests in this task)

- [ ] **Step 1: Add `_qwen_env` and `_call_qwen` above `parse_chunk`** (after the `_PROMPT_TEMPLATE` block, before `async def parse_chunk`):

```python
def _qwen_env(
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> tuple[str, str, int, float, bool]:
    """Resolve Qwen connection settings from args/env.

    Returns (endpoint, model_name, retries, timeout_s, enable_thinking).
    Qwen3.5 emits chain-of-thought by default, which is slow; we disable thinking
    unless QWEN_ENABLE_THINKING=1.
    """
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))
    enable_thinking = os.environ.get("QWEN_ENABLE_THINKING", "0") == "1"
    return endpoint, model_name, retries, timeout_s, enable_thinking


async def _call_qwen(
    prompt: str,
    *,
    label: str,
    endpoint: str,
    model_name: str,
    retries: int,
    timeout_s: float,
    enable_thinking: bool,
) -> dict:
    """POST one chat-completion, strip thinking + markdown fences, return parsed
    JSON. Retries with exponential backoff. Raises ValueError after `retries`
    attempts. `label` identifies the caller in log lines / the error message."""
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
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
                cleaned = _THINKING_RE.sub("", raw).strip()
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                data = json.loads(cleaned)
                logger.info("[qwen] %s attempt %d/%d OK", label, attempt, retries)
                return data
        except httpx.HTTPError as exc:
            # Connection/transport/HTTP-status error. repr() because ReadError/
            # ConnectError stringify to an empty message.
            logger.warning(
                "[qwen] %s attempt %d/%d: cannot reach Qwen at %s -> %s",
                label, attempt, retries, endpoint, repr(exc),
            )
            last_exc = exc
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning(
                "[qwen] %s attempt %d/%d: invalid response from Qwen -> %s",
                label, attempt, retries, repr(exc),
            )
            last_exc = exc

    if isinstance(last_exc, httpx.HTTPError):
        reason = f"could not reach Qwen endpoint {endpoint}/v1/chat/completions"
    else:
        reason = "could not parse JSON from Qwen response"
    raise ValueError(
        f"{reason} for {label} after {retries} attempts "
        f"(last error: {type(last_exc).__name__}: {last_exc})"
    ) from last_exc
```

- [ ] **Step 2: Rewrite `parse_chunk` to use them.** Replace the body of `parse_chunk` from its first line through the `else:` retry-failure block (i.e. lines that resolve env, build the prompt, run the `for/else` loop, set `scenes_data`) with the version below. Keep the `raw_scenes = ...` / normalize / learn / save / write block that follows **unchanged**.

```python
async def parse_chunk(
    chunk_id: str,
    chunk_text: str,
    episode_id: str,
    output_dir: Path,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> Path:
    """Call Qwen, write {chunk_id}_scenes.json into output_dir, return its path."""
    endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env(
        qwen_endpoint, model, max_retries
    )

    registry = entity_registry.load(episode_id, output_dir)
    known = registry.known_names()
    prompt = _PROMPT_TEMPLATE.format(
        chunk_id=chunk_id,
        chunk_text=chunk_text,
        emotions=", ".join(EMOTIONS),
        intensities=" | ".join(INTENSITIES),
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
    )

    logger.info(
        "[parse_chunk] chunk=%s episode=%s endpoint=%s model=%s chars=%d retries=%d timeout=%.0fs thinking=%s",
        chunk_id, episode_id, endpoint, model_name, len(chunk_text), retries, timeout_s, enable_thinking,
    )

    scenes_data = await _call_qwen(
        prompt, label=chunk_id, endpoint=endpoint, model_name=model_name,
        retries=retries, timeout_s=timeout_s, enable_thinking=enable_thinking,
    )

    raw_scenes = scenes_data.get("scenes", [])
    scenes = [registry.normalize_scene(s) for s in raw_scenes]
    registry.learn(scenes)
    entity_registry.save(
        registry, output_dir, now=datetime.now(timezone.utc).isoformat()
    )

    out_path = output_dir / f"{chunk_id}_scenes.json"
    result = {
        "chunk_id": chunk_id,
        "source_file": episode_id + ".txt",
        "model": model_name,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "scenes": scenes,
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[parse_chunk] chunk=%s wrote %s (%d scenes)", chunk_id, out_path, len(result["scenes"]))
    return out_path
```

- [ ] **Step 3: Run the existing scene_parser tests to confirm behaviour is preserved**

Run: `python -m pytest tests/test_scene_parser.py -q` (inline, do NOT pipe)
Expected: all existing tests PASS (7 passed). Critically `test_parse_chunk_fails_after_max_retries` (matches `"could not parse JSON"`), `test_parse_chunk_retries_on_bad_json` (counts 3 posts), and `test_parse_chunk_prompt_includes_emotions_and_known_names` (reads `payload["messages"][0]["content"]`) still pass.

- [ ] **Step 4: Run the full backend suite**

Run: `python -m pytest tests/ -q` (inline)
Expected: all pass (109).

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_parser.py
git commit -m "refactor(parse): extract shared _call_qwen / _qwen_env helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-T2: `reparse_scene` (single-scene re-extraction)

**Files:**
- Modify: `animatory/scene_parser.py` (add `_REPARSE_TEMPLATE` + `reparse_scene`)
- Test: `tests/test_scene_parser.py` (append)

- [ ] **Step 1: Write the failing tests** (append; reuse `_make_mock_response` and the `er` import already in the file):

```python
@pytest.mark.asyncio
async def test_reparse_scene_normalizes_and_forces_id(tmp_path):
    from animatory.scene_parser import reparse_scene
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
    )
    returned = {
        "scene_id": "WRONG_ID",  # model returns the wrong id — must be forced back
        "location": "Hall", "characters": ["đại cản"], "shot_type": "wide",
        "action": "đại cản bước vào",
        "dialogue": [{"character": "đại cản", "line": "Quỳ.", "emotion": "commanding"}],
        "narration": [], "mood": "tense",
    }
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(returned)))
        MockClient.return_value = instance
        scene = await reparse_scene(
            chunk_id="C001", chunk_text="whole chunk text",
            anchor_scene={"scene_id": "C001_S02", "action": "old action"},
            registry=reg, scene_id="C001_S02",
        )
    assert scene["scene_id"] == "C001_S02"            # forced to requested id
    assert scene["characters"] == ["Đại Càn"]          # normalized
    assert scene["dialogue"][0]["character"] == "Đại Càn"
    assert scene["dialogue"][0]["emotion"] == "commanding"
    assert len(reg.characters) == 1                     # NOT grown (no learn)
    assert not (tmp_path / "entities.json").exists()    # no registry save


@pytest.mark.asyncio
async def test_reparse_scene_handles_scenes_wrapper():
    from animatory.scene_parser import reparse_scene
    reg = er.EntityRegistry(episode_id="ep1")
    wrapped = {"scenes": [{
        "scene_id": "x", "location": "L", "characters": [], "shot_type": "wide",
        "action": "a", "dialogue": [], "narration": [], "mood": "m",
    }]}
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_make_mock_response(json.dumps(wrapped)))
        MockClient.return_value = instance
        scene = await reparse_scene(
            chunk_id="C001", chunk_text="t",
            anchor_scene={"scene_id": "C001_S01"}, registry=reg, scene_id="C001_S01",
        )
    assert scene["scene_id"] == "C001_S01"
    assert scene["location"] == "L"


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
    assert "ANCHOR_MARKER" in prompt          # anchor scene included
    assert "Tư An" in prompt                   # known names included
    assert "the full chapter body" in prompt   # whole chunk included
    assert "commanding" in prompt              # emotion vocab present
```

- [ ] **Step 2: Run, confirm FAIL** (`ImportError: cannot import name 'reparse_scene'`)

Run: `python -m pytest tests/test_scene_parser.py -q -k reparse`

- [ ] **Step 3: Add `_REPARSE_TEMPLATE` and `reparse_scene`** to `animatory/scene_parser.py` (place `_REPARSE_TEMPLATE` after `_PROMPT_TEMPLATE`; place `reparse_scene` after `parse_chunk`):

```python
_REPARSE_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Re-extract a SINGLE scene from the chapter text below. You are CORRECTING one
existing scene — fix mistakes: wrong speaker attribution, narration mistaken for
dialogue (or vice versa), wrong character/location spelling, and emotions.

Return ONLY one scene as valid JSON (a single object, NOT an array, no markdown)
matching this schema, keeping the SAME "scene_id":

{{
  "scene_id": "{scene_id}",
  "location": "string",
  "characters": ["string"],
  "shot_type": "wide | medium | close-up | insert | POV",
  "action": "string",
  "dialogue": [
    {{"character": "string", "line": "string", "emotion": "one of: {emotions}", "intensity": "one of: {intensities}"}}
  ],
  "narration": ["string"],
  "mood": "string"
}}

Rules:
- "dialogue" holds ONLY lines spoken aloud by a named character; "narration" is
  narrator / voice-over prose. Do NOT invent a "Narrator" character.
- Choose "emotion" from the listed set (omit if unclear); "intensity" is optional.
- Known names — use EXACTLY these spellings:
  characters: {known_characters}
  locations: {known_locations}

The scene to re-extract currently looks like this (use it to locate the right
part of the chapter):
{anchor}

Chapter text:
---
{chunk_text}
---"""


async def reparse_scene(
    chunk_id: str,
    chunk_text: str,
    anchor_scene: dict,
    registry: entity_registry.EntityRegistry,
    *,
    scene_id: str,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> dict:
    """Re-extract a single scene from the chapter. Sends the whole chunk plus the
    scene as an anchor; consults the registry for known names and normalizes the
    result. Does NOT write files, learn, or save the registry — the caller decides
    whether to keep the result."""
    endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env(
        qwen_endpoint, model, max_retries
    )
    known = registry.known_names()
    prompt = _REPARSE_TEMPLATE.format(
        scene_id=scene_id,
        emotions=", ".join(EMOTIONS),
        intensities=" | ".join(INTENSITIES),
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
        anchor=json.dumps(anchor_scene, ensure_ascii=False, indent=2),
        chunk_text=chunk_text,
    )

    logger.info(
        "[reparse_scene] chunk=%s scene=%s chars=%d", chunk_id, scene_id, len(chunk_text)
    )

    data = await _call_qwen(
        prompt, label=scene_id, endpoint=endpoint, model_name=model_name,
        retries=retries, timeout_s=timeout_s, enable_thinking=enable_thinking,
    )

    # Accept a bare object, a list, or a {"scenes": [obj]} wrapper.
    if isinstance(data, list):
        scene = data[0] if data else {}
    elif isinstance(data, dict) and isinstance(data.get("scenes"), list):
        scene = data["scenes"][0] if data["scenes"] else {}
    else:
        scene = data

    scene = dict(scene)
    scene["scene_id"] = scene_id  # always keep the requested id
    return registry.normalize_scene(scene)
```

Note: the `anchor` value is JSON passed as a `.format` argument, so its braces are safe; only the template's own literal JSON braces are doubled (`{{ }}`).

- [ ] **Step 4: Run the reparse tests, confirm PASS**

Run: `python -m pytest tests/test_scene_parser.py -q -k reparse` (inline)
Expected: 3 passed.

- [ ] **Step 5: Run the full scene_parser file + full suite**

Run: `python -m pytest tests/test_scene_parser.py -q` then `python -m pytest tests/ -q` (inline)
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add animatory/scene_parser.py tests/test_scene_parser.py
git commit -m "feat(parse): reparse_scene re-extracts one scene (consult+normalize, no learn)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-T3: Per-scene reparse route

**Files:**
- Modify: `animatory/pipeline_router.py` (import + route)
- Test: `tests/test_pipeline_api.py` (append)

- [ ] **Step 1: Append the route tests** to `tests/test_pipeline_api.py`.

Check the top of the file for existing imports — if `from unittest.mock import ...` is absent, add `from unittest.mock import AsyncMock, patch, MagicMock`. Add the `_qwen_resp` helper near the other helpers (only if not already present). Reuse the existing `_chunk_episode` helper.

```python
from unittest.mock import AsyncMock, patch, MagicMock


def _qwen_resp(content: str):
    m = MagicMock()
    m.raise_for_status = MagicMock()
    m.json.return_value = {"choices": [{"message": {"content": content}}]}
    return m


def _patch_qwen(content: str):
    """Context manager patching scene_parser's httpx.AsyncClient to return `content`."""
    cm = patch("animatory.scene_parser.httpx.AsyncClient")
    return cm  # caller configures the returned mock


@pytest.mark.asyncio
async def test_reparse_route_returns_scene(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rptest")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    sid = f"{cid}_S01"
    (ep_dir / f"{cid}_scenes.json").write_text(_json.dumps({"chunk_id": cid, "scenes": [
        {"scene_id": sid, "location": "L", "characters": ["A"], "shot_type": "wide",
         "action": "old", "dialogue": [], "narration": [], "mood": "m"}]}), encoding="utf-8")

    returned = {"scene_id": sid, "location": "L2", "characters": ["A"], "shot_type": "medium",
                "action": "new action", "dialogue": [], "narration": [], "mood": "calm"}
    with patch("animatory.scene_parser.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=_qwen_resp(_json.dumps(returned)))
        MockClient.return_value = instance
        r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{sid}/reparse")

    assert r.status_code == 200
    body = r.json()
    assert body["scene"]["scene_id"] == sid
    assert body["scene"]["action"] == "new action"


@pytest.mark.asyncio
async def test_reparse_route_404_unknown_scene(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rp404")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    (ep_dir / f"{cid}_scenes.json").write_text(
        _json.dumps({"chunk_id": cid, "scenes": []}), encoding="utf-8")

    r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/NOPE_S99/reparse")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_reparse_route_409_when_not_parsed(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="rp409")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    r = await client.post(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{cid}_S01/reparse")
    assert r.status_code == 409
```

(`_patch_qwen` is unused convenience; if you prefer, omit it. Keep `_qwen_resp`.)
Simplify: you may drop the `_patch_qwen` helper entirely — only `_qwen_resp` is used by the tests.

- [ ] **Step 2: Run, confirm FAIL** (404/405 — route missing, or wrong status)

Run: `python -m pytest tests/test_pipeline_api.py -q -k reparse`

- [ ] **Step 3: Implement the route.** In `animatory/pipeline_router.py`:

(a) Update the scene_parser import — it currently reads `from animatory.scene_parser import parse_episode`. Change it to:
```python
from animatory.scene_parser import parse_episode, reparse_scene
```

(b) Add the route after `reset_chunk_scenes` (before the text routes), alongside the other scene routes:
```python
@router.post("/episodes/{episode_id}/chunks/{chunk_id}/scenes/{scene_id}/reparse")
async def reparse_chunk_scene(episode_id: str, chunk_id: str, scene_id: str):
    """Re-extract a single scene from source and return it (NOT persisted).

    The frontend applies the result via the normal save flow. Consults + normalizes
    against the entity registry but does not grow it.
    """
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)  # 404 if episode/chunk unknown
    doc = _scenes_payload(ep_dir, chunk_id)
    if doc is None:
        raise HTTPException(status_code=409, detail=f"Chunk '{chunk_id}' has not been parsed yet")
    anchor = next((s for s in doc.get("scenes", []) if s.get("scene_id") == scene_id), None)
    if anchor is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found in chunk '{chunk_id}'")

    chunk_text = _text_payload(ep_dir, chunk_id, meta)["text"]
    registry = entity_registry.load(episode_id, ep_dir)
    scene = await reparse_scene(
        chunk_id=chunk_id, chunk_text=chunk_text, anchor_scene=anchor,
        registry=registry, scene_id=scene_id,
    )
    logger.info("[reparse] episode=%s chunk=%s scene=%s done", episode_id, chunk_id, scene_id)
    return {"scene": scene}
```

(`entity_registry` is already imported in this module from B-T6.)

- [ ] **Step 4: Run the route tests, confirm PASS**

Run: `python -m pytest tests/test_pipeline_api.py -q -k reparse` (inline)
Expected: 3 passed.

- [ ] **Step 5: Full suite**

Run: `python -m pytest tests/ -q` (inline)
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(parse): per-scene reparse route (returns scene, no persist)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-T4: Frontend `reparseScene` client

**Files:**
- Modify: `frontend/src/api/pipeline.ts`
- Test: `frontend/src/api/pipeline.test.ts` (append)

- [ ] **Step 1: Append the test** (reuse the existing `mockFetch` + `afterEach` in this file; add `reparseScene` to the import from `./pipeline`):

```typescript
import { reparseScene } from './pipeline'

describe('reparseScene client', () => {
  it('POSTs to the scene reparse route and returns the scene', async () => {
    const f = mockFetch({ scene: { scene_id: 'C001_S01', location: 'L', characters: [], shot_type: 'wide', action: 'new', dialogue: [], mood: 'm', narration: [] } })
    vi.stubGlobal('fetch', f)
    const { scene } = await reparseScene('ep1', 'C001', 'C001_S01')
    expect(scene.action).toBe('new')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/chunks/C001/scenes/C001_S01/reparse')
    expect(init.method).toBe('POST')
  })

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'nope' }, false, 404))
    await expect(reparseScene('ep1', 'C001', 'X')).rejects.toThrow(/404/)
  })
})
```

- [ ] **Step 2: Run, confirm FAIL** (`reparseScene` not exported)

Run (from `frontend/`): `npm test -- pipeline`

- [ ] **Step 3: Add the client** at the end of `frontend/src/api/pipeline.ts`:

```typescript
export async function reparseScene(
  episodeId: string, chunkId: string, sceneId: string,
): Promise<{ scene: PipelineScene }> {
  const res = await fetch(
    `${chunkBase(episodeId, chunkId)}/scenes/${encodeURIComponent(sceneId)}/reparse`,
    { method: 'POST' },
  )
  return jsonOrThrow<{ scene: PipelineScene }>(res, 'reparseScene')
}
```

(`chunkBase` and `jsonOrThrow` already exist in this file.)

- [ ] **Step 4: Run, confirm PASS**

Run (from `frontend/`): `npm test -- pipeline` (inline)
Expected: all pass (existing + 2 new).

- [ ] **Step 5: Build**

Run (from `frontend/`): `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/pipeline.ts frontend/src/api/pipeline.test.ts
git commit -m "feat(parse): frontend reparseScene client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-T5: EditableSceneCard — Re-parse button

**Files:**
- Modify: `frontend/src/components/refine/EditableSceneCard.tsx`

> **UI task — invoke the `ui-taste` skill before editing JSX.** The Re-parse control sits beside the existing "Edit" button in the card header (read mode only), same `text-[11px] text-steel hover:text-ink` treatment, `transition-colors`, focus-visible ring, disabled + "Re-parsing…" label while in flight. One accent only. No DOM tests.

- [ ] **Step 1: Extend the Props interface.** Add two props to the `Props` interface:
```tsx
  onReparse: () => void
  reparsing: boolean
```
And destructure them in the component signature alongside the existing props (`scene, isEditing, proposal, onEdit, onCancel, onSaveLocal, onAcceptProposal, onRejectProposal, onReparse, reparsing`).

- [ ] **Step 2: Render the button** in the read-mode header, immediately before the existing `Edit` button (inside the `<div className="flex items-center gap-2 shrink-0">`):
```tsx
          <button
            onClick={onReparse}
            disabled={reparsing}
            className="text-[11px] text-steel hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          >
            {reparsing ? 'Re-parsing…' : 'Re-parse'}
          </button>
```

- [ ] **Step 3: Build**

Run (from `frontend/`): `npm run build`
Expected: clean (TS will require callers to pass the new required props — ChapterView is updated in C-T6; if you build before C-T6 it will error on the missing props at the EditableSceneCard usage. To keep this task independently green, temporarily it's acceptable that the app-wide build fails ONLY at the ChapterView call site until C-T6. Verify instead that EditableSceneCard.tsx itself has no type errors by checking the error is solely the missing-prop at ChapterView. If you prefer a clean build at every task boundary, make the two props optional with defaults: `onReparse?: () => void` and `reparsing?: boolean = false` — but the plan's intent is required props wired in C-T6.)**

To avoid an ambiguous build state, make the props **required** and proceed; C-T6 immediately follows and supplies them. Confirm `tsc` errors (if any) are limited to `ChapterView.tsx` missing-prop, not within `EditableSceneCard.tsx`.

- [ ] **Step 4: ui-taste smell test** on the new button (matches sibling Edit button styling, focus ring, disabled state, no emoji). Fix inline.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/refine/EditableSceneCard.tsx
git commit -m "feat(parse): Re-parse button on scene cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-T6: ChapterView wiring

**Files:**
- Modify: `frontend/src/studio/views/ChapterView.tsx`

> **UI task — invoke the `ui-taste` skill first.** The re-parse error line uses `text-brand-error`, restrained, near the scenes header. One accent.

- [ ] **Step 1: Import the client.** Add `reparseScene` to the existing import from `'../../api/pipeline'` (the line that imports `getChunkScenes, getChunkText, parseEpisode, saveScenes, saveText, resetScenes, resetText, type PipelineScene, ...`):
```tsx
  getChunkScenes, getChunkText, parseEpisode,
  saveScenes, saveText, resetScenes, resetText, reparseScene,
  type PipelineScene, type ScenePatch, type TextCorrection,
```

- [ ] **Step 2: Add state.** Near the other scene state (after `const [savingScenes, setSavingScenes] = useState(false)`), add:
```tsx
  const [reparsing, setReparsing] = useState<Set<string>>(new Set())
  const [reparseError, setReparseError] = useState('')
```

- [ ] **Step 3: Add the handler.** Near the other scene actions (e.g. after `rejectProposal`), add:
```tsx
  async function onReparseScene(sceneId: string) {
    setReparsing(prev => new Set(prev).add(sceneId))
    setReparseError('')
    try {
      const { scene } = await reparseScene(episodeId, chunkId, sceneId)
      const { scene_id, ...changes } = scene
      setProposals(prev => ({
        ...prev,
        [sceneId]: { scene_id: sceneId, changes, rationale: 'Re-parsed from source' },
      }))
    } catch (e) {
      setReparseError(`Re-parse failed: ${String(e)}`)
    } finally {
      setReparsing(prev => { const n = new Set(prev); n.delete(sceneId); return n })
    }
  }
```

- [ ] **Step 4: Pass the new props** to `EditableSceneCard`. In the `scenes.map(...)` render, add to the `<EditableSceneCard ... />` element:
```tsx
                      onReparse={() => onReparseScene(s.scene_id)}
                      reparsing={reparsing.has(s.scene_id)}
```

- [ ] **Step 5: Show the error line.** Inside the parsed branch, next to the existing `{skipped > 0 && (...)}` notice (just before the `<div className="space-y-2.5">` that maps scenes), add:
```tsx
                {reparseError && (
                  <div className="mb-2 text-[11px] text-brand-error">{reparseError}</div>
                )}
```

- [ ] **Step 6: Build**

Run (from `frontend/`): `npm run build`
Expected: clean (the missing-prop error from C-T5 is now resolved).

- [ ] **Step 7: ui-taste smell test** (error line uses token color, restrained; one accent; no emoji). Fix inline.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/studio/views/ChapterView.tsx
git commit -m "feat(parse): wire per-scene reparse into ChapterView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-T7: ui-taste pass + full verification

- [ ] **Step 1: Invoke the `ui-taste` skill** and run its smell test on the Re-parse button (EditableSceneCard) and the reparse error line + section (ChapterView): one accent (`#3772cf`), token-only color, real disabled/loading state on the button, `text-brand-error` for the error, focus-visible ring, no emoji-as-placeholder, restrained motion. Fix any violations inline.

- [ ] **Step 2: Full frontend suite + build**

Run (from `frontend/`): `npm test && npm run build`
Expected: all tests pass; build clean.

- [ ] **Step 3: Full backend suite**

Run: `python -m pytest tests/ -q` (inline)
Expected: all pass.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "polish(parse): ui-taste pass on per-scene reparse

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(If there were no fixes to make, skip this commit.)

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3.1 shared `_call_qwen` refactor → C-T1.
- §3.2 `reparse_scene` (consult+normalize, no learn, force scene_id, wrapper-tolerant) → C-T2.
- §3.3 route (404 unknown scene, 409 not parsed, edited text/scenes preferred, returns `{scene}`, no persist) → C-T3.
- §4 frontend client → C-T4; Re-parse button → C-T5; ChapterView wiring (reparsing set, handler→proposal, error line) → C-T6.
- §5 testing → embedded per task; C-T7 full-suite gate.
- §6 out-of-scope honored (no offset storage, no free-text hint, no persist/learn, no bulk, reuse existing proposal block).

**Type consistency:** route returns `{scene}` ↔ `reparseScene` returns `{scene: PipelineScene}`; the proposal built in C-T6 is `{scene_id, changes, rationale}` matching `ScenePatch` (`changes: Partial<Omit<PipelineScene,'scene_id'>>` — `const {scene_id, ...changes} = scene` yields exactly that). `reparse_scene` signature in C-T2 matches its call site in C-T3. `_call_qwen`/`_qwen_env` signatures in C-T1 match both call sites (parse_chunk, reparse_scene). EditableSceneCard's new required props (`onReparse`, `reparsing`) are supplied in C-T6.

**Placeholder scan:** none — every code/test step has full content. (C-T5 Step 3 notes a deliberate, explained transient cross-task build dependency resolved in C-T6.)
