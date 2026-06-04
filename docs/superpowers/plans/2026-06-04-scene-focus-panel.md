# Scene Focus Panel + Scene Source Location — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user open one scene in a focused modal that shows the scene readably, the chapter source passage it came from (highlighted), and the existing refine chat seeded with `@Scene`, while `@Scene` mentions also attach that scene's source passage to chat context.

**Architecture:** A new pure backend module `scene_source.py` does best-effort line matching (scene dialogue/narration/action → chapter lines). A GET endpoint serves it to the panel; `chat_stream` reuses it so `@Scene` attaches the located passage. On the frontend, the card's read view is extracted into a shared `SceneReadView` (reused by card, proposal block, and panel); a new `SceneFocusPanel` modal hosts the relocated `RefineChat`.

**Tech Stack:** Python 3.11 / FastAPI / pytest (backend); React 18 + TypeScript + Vite + Tailwind / vitest (frontend).

Spec: `docs/superpowers/specs/2026-06-04-scene-focus-panel-design.md`

---

## Task 1: `scene_source.locate` (pure matcher)

**Files:**
- Create: `animatory/scene_source.py`
- Test: `tests/test_scene_source.py`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_scene_source.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'animatory.scene_source'`

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/scene_source.py
from __future__ import annotations

import re
from typing import TypedDict

MIN_NEEDLE_CHARS = 8

_WS_RE = re.compile(r"\s+")
# Stripped from the edges only: quotes, dialogue dashes, ellipsis, outer punctuation.
# Diacritics are intentionally preserved (no accent folding).
_EDGE_CHARS = "\"'“”‘’«»—–-…().,!?;: "


class SceneSource(TypedDict):
    found: bool
    match_lines: list[int]   # 0-based indices into chunk_text.splitlines()
    line_start: int          # min(match_lines), or -1 when none
    line_end: int            # max(match_lines), or -1 when none
    excerpt: str             # lines[line_start..line_end] joined, or ""


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", s).strip().lower().strip(_EDGE_CHARS)


def _needles(scene: dict) -> list[str]:
    out: list[str] = []
    for d in scene.get("dialogue") or []:
        if isinstance(d, dict) and d.get("line"):
            out.append(d["line"])
    for n in scene.get("narration") or []:
        if n:
            out.append(n)
    if scene.get("action"):
        out.append(scene["action"])
    return out


def locate(scene: dict, chunk_text: str) -> SceneSource:
    """Best-effort: which chapter lines did this scene come from?

    Heuristic normalized-substring matching of the scene's dialogue lines,
    narration, and action against the chapter's lines. Pure; no I/O.
    """
    lines = chunk_text.splitlines()
    norm_lines = [_norm(ln) for ln in lines]
    needles = [n for n in (_norm(x) for x in _needles(scene)) if len(n) >= MIN_NEEDLE_CHARS]

    matched: set[int] = set()
    for needle in needles:
        for i, ln in enumerate(norm_lines):
            if not ln:
                continue
            if needle in ln or (len(ln) >= MIN_NEEDLE_CHARS and ln in needle):
                matched.add(i)

    if not matched:
        return {"found": False, "match_lines": [], "line_start": -1, "line_end": -1, "excerpt": ""}

    ordered = sorted(matched)
    start, end = ordered[0], ordered[-1]
    return {
        "found": True,
        "match_lines": ordered,
        "line_start": start,
        "line_end": end,
        "excerpt": "\n".join(lines[start : end + 1]),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_scene_source.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_source.py tests/test_scene_source.py
git commit -m "feat(parse): best-effort scene-to-source line locator"
```

---

## Task 2: Source endpoint

**Files:**
- Modify: `animatory/pipeline_router.py` (add import + one route after the reparse route at line ~407)
- Test: `tests/test_pipeline_api.py` (append)

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_pipeline_api.py
@pytest.mark.asyncio
async def test_scene_source_route_returns_match(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="srctest")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    sid = f"{cid}_S01"
    # Edited text is preferred by the route — write known content there.
    (ep_dir / f"{cid}.edited.txt").write_text(
        "Dòng đầu không khớp.\nTu An chạy trốn khỏi phủ công chúa.\nDòng cuối.",
        encoding="utf-8")
    (ep_dir / f"{cid}_scenes.json").write_text(_json.dumps({"chunk_id": cid, "scenes": [
        {"scene_id": sid, "location": "L", "characters": [], "shot_type": "wide",
         "action": "Tu An chạy trốn khỏi phủ công chúa.", "dialogue": [], "narration": [], "mood": "m"}]}),
        encoding="utf-8")

    r = await client.get(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{sid}/source")
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["line_start"] == 1 and body["line_end"] == 1
    assert "Tu An chạy trốn" in body["excerpt"]


@pytest.mark.asyncio
async def test_scene_source_route_404_unknown_scene(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="src404")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    (ep_dir / f"{cid}_scenes.json").write_text(
        _json.dumps({"chunk_id": cid, "scenes": []}), encoding="utf-8")
    r = await client.get(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/NOPE_S99/source")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_scene_source_route_409_when_not_parsed(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="src409")
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    r = await client.get(f"/pipeline/episodes/{ep}/chunks/{cid}/scenes/{cid}_S01/source")
    assert r.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_pipeline_api.py -k scene_source -v`
Expected: FAIL — 404 from FastAPI (route not registered) so `body["found"]` assertion errors / status mismatch.

- [ ] **Step 3: Add the import**

In `animatory/pipeline_router.py`, change the existing import line:

```python
from animatory import entity_registry
```
to:
```python
from animatory import entity_registry, scene_source
```

- [ ] **Step 4: Add the route**

Insert directly after the `reparse_chunk_scene` function (after line ~407, before `get_entities`):

```python
@router.get("/episodes/{episode_id}/chunks/{chunk_id}/scenes/{scene_id}/source")
async def get_scene_source(episode_id: str, chunk_id: str, scene_id: str):
    """Best-effort: locate where this scene's text sits in the chapter source.

    Read-only. Uses edited-preferred text + scenes (the same the panel renders),
    so returned line indices line up with the chapter text the client displays.
    """
    ep_dir = _processed_dir() / episode_id
    meta = _chunk_meta(ep_dir, chunk_id)  # 404 if episode/chunk unknown
    doc = _scenes_payload(ep_dir, chunk_id)
    if doc is None:
        raise HTTPException(status_code=409, detail=f"Chunk '{chunk_id}' has not been parsed yet")
    scene = next((s for s in doc.get("scenes", []) if s.get("scene_id") == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail=f"Scene '{scene_id}' not found in chunk '{chunk_id}'")
    text = _text_payload(ep_dir, chunk_id, meta)["text"]
    return scene_source.locate(scene, text)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_pipeline_api.py -k scene_source -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(parse): GET scene source-location endpoint"
```

---

## Task 3: `@Scene` attaches located source to chat context

**Files:**
- Modify: `animatory/chat_engine.py` (`_build_messages`, `stream_chat`)
- Modify: `animatory/pipeline_router.py` (`chat_stream`)
- Test: `tests/test_chat_engine.py` (append)

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_chat_engine.py
def test_build_messages_injects_source_passage_for_mentioned_scene():
    msgs = _build_messages(
        scene_index=[{"scene_id": "C001_S03", "location": "Phố", "characters": ["Tu An"]}],
        mentioned_scenes=[{"scene_id": "C001_S03", "dialogue": []}],
        raw_text=None,
        messages=[{"role": "user", "content": "fix scene 3"}],
        use_tools=True,
        scene_sources={"C001_S03": "Tu An chạy trốn khỏi phủ công chúa."},
    )
    system_msgs = [m for m in msgs if m["role"] == "system"]
    assert len(system_msgs) == 1                      # still exactly one leading system turn
    assert "Source passage for C001_S03" in msgs[0]["content"]
    assert "Tu An chạy trốn" in msgs[0]["content"]


def test_build_messages_skips_empty_source_passage():
    msgs = _build_messages(
        scene_index=[], mentioned_scenes=[{"scene_id": "C001_S03"}], raw_text=None,
        messages=[{"role": "user", "content": "hi"}], use_tools=True,
        scene_sources={"C001_S03": ""},               # no match found -> no block
    )
    assert "Source passage" not in msgs[0]["content"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_chat_engine.py -k source_passage -v`
Expected: FAIL — `TypeError: _build_messages() got an unexpected keyword argument 'scene_sources'`

- [ ] **Step 3: Update `_build_messages`**

In `animatory/chat_engine.py`, replace the `_build_messages` function with:

```python
def _build_messages(scene_index, mentioned_scenes, raw_text, messages, use_tools, scene_sources=None) -> list[dict]:
    system = _SYSTEM if use_tools else _SYSTEM + _FALLBACK_NOTE
    lines = ["Scenes in this chapter (id · location · characters):"]
    for s in scene_index:
        chars = ", ".join(s.get("characters", []))
        lines.append(f"- {s['scene_id']} · {s.get('location', '')} · {chars}")
    ctx = "\n".join(lines)
    if mentioned_scenes:
        ctx += "\n\nFull detail for mentioned scene(s):\n" + json.dumps(mentioned_scenes, ensure_ascii=False)
    for sid, excerpt in (scene_sources or {}).items():
        if excerpt:
            ctx += f"\n\nSource passage for {sid}:\n---\n{excerpt}\n---"
    if raw_text:
        ctx += f"\n\nRaw chapter text:\n---\n{raw_text}\n---"
    # Qwen's chat template allows only ONE system message and it must be first;
    # a second system turn raises "System message must be at the beginning."
    # Fold the instructions + per-chapter context into a single leading turn.
    return (
        [{"role": "system", "content": system + "\n\n" + ctx}]
        + [{"role": m["role"], "content": m["content"]} for m in messages]
    )
```

- [ ] **Step 4: Thread `scene_sources` through `stream_chat`**

In `animatory/chat_engine.py`, update the `stream_chat` signature and the `_build_messages` call.

Change the signature block:
```python
async def stream_chat(
    chunk_id: str,
    scene_index: list[dict],
    mentioned_scenes: list[dict],
    raw_text: str | None,
    messages: list[dict],
    thinking: bool,
    *,
    qwen_endpoint: str | None = None,
    model: str | None = None,
) -> AsyncIterator[dict]:
```
to add `scene_sources`:
```python
async def stream_chat(
    chunk_id: str,
    scene_index: list[dict],
    mentioned_scenes: list[dict],
    raw_text: str | None,
    messages: list[dict],
    thinking: bool,
    *,
    scene_sources: dict[str, str] | None = None,
    qwen_endpoint: str | None = None,
    model: str | None = None,
) -> AsyncIterator[dict]:
```

And change the `_build_messages(...)` call inside the payload from:
```python
        "messages": _build_messages(scene_index, mentioned_scenes, raw_text, messages, use_tools),
```
to:
```python
        "messages": _build_messages(scene_index, mentioned_scenes, raw_text, messages, use_tools, scene_sources),
```

- [ ] **Step 5: Compute + pass `scene_sources` in the route**

In `animatory/pipeline_router.py`, inside `chat_stream`, replace this block:

```python
    wanted = set(body.mentions.scenes) & valid_ids
    mentioned = [s for s in all_scenes if s["scene_id"] in wanted]
    raw_text = _text_payload(ep_dir, chunk_id, meta)["text"] if body.mentions.raw else None
```
with:
```python
    wanted = set(body.mentions.scenes) & valid_ids
    mentioned = [s for s in all_scenes if s["scene_id"] in wanted]
    chapter_text = _text_payload(ep_dir, chunk_id, meta)["text"]
    scene_sources = {s["scene_id"]: scene_source.locate(s, chapter_text)["excerpt"] for s in mentioned}
    raw_text = chapter_text if body.mentions.raw else None
```

Then update the `stream_chat(...)` call from:
```python
        async for ev in stream_chat(
            chunk_id=chunk_id, scene_index=scene_index, mentioned_scenes=mentioned,
            raw_text=raw_text, messages=history, thinking=body.thinking,
        ):
```
to:
```python
        async for ev in stream_chat(
            chunk_id=chunk_id, scene_index=scene_index, mentioned_scenes=mentioned,
            raw_text=raw_text, messages=history, thinking=body.thinking,
            scene_sources=scene_sources,
        ):
```

(`scene_source` is already imported from Task 2.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/test_chat_engine.py tests/test_pipeline_api.py -v`
Expected: PASS (all chat_engine + pipeline tests green, including the two new ones)

- [ ] **Step 7: Commit**

```bash
git add animatory/chat_engine.py animatory/pipeline_router.py tests/test_chat_engine.py
git commit -m "feat(chat): @Scene attaches located source passage to context"
```

---

## Task 4: Frontend `getSceneSource` client

**Files:**
- Modify: `frontend/src/api/pipeline.ts` (append)
- Test: `frontend/src/api/pipeline.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```typescript
// append inside frontend/src/api/pipeline.test.ts (new describe block)
describe('getSceneSource client', () => {
  it('GETs the scene source route and returns the match', async () => {
    const f = mockFetch({ found: true, match_lines: [1], line_start: 1, line_end: 1, excerpt: 'x' })
    vi.stubGlobal('fetch', f)
    const res = await getSceneSource('ep1', 'C001', 'C001_S03')
    expect(res.found).toBe(true)
    expect(res.match_lines).toEqual([1])
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/chunks/C001/scenes/C001_S03/source')
    expect(init).toBeUndefined()  // plain GET, no init object
  })

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'no' }, false, 409))
    await expect(getSceneSource('ep1', 'C001', 'X')).rejects.toThrow(/409/)
  })
})
```

Also add `getSceneSource` to the import at the top of the test file:
```typescript
import { saveText, saveScenes, getEntities, saveEntities, getVoiceProfiles, EMOTIONS, reparseScene, getSceneSource } from './pipeline'
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm run test -- pipeline.test.ts`
Expected: FAIL — `getSceneSource is not exported` / is not a function.

- [ ] **Step 3: Add the client + type**

Append to `frontend/src/api/pipeline.ts`:

```typescript
export interface SceneSource {
  found: boolean
  match_lines: number[]
  line_start: number
  line_end: number
  excerpt: string
}

export async function getSceneSource(
  episodeId: string, chunkId: string, sceneId: string,
): Promise<SceneSource> {
  const res = await fetch(
    `${chunkBase(episodeId, chunkId)}/scenes/${encodeURIComponent(sceneId)}/source`,
  )
  return jsonOrThrow<SceneSource>(res, 'getSceneSource')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npm run test -- pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/pipeline.ts frontend/src/api/pipeline.test.ts
git commit -m "feat(parse): getSceneSource API client"
```

---

## Task 5: Extract shared `SceneReadView`; use it in card + proposal block

**Files:**
- Create: `frontend/src/components/refine/SceneReadView.tsx`
- Modify: `frontend/src/components/refine/EditableSceneCard.tsx`

- [ ] **Step 1: Create `SceneReadView`**

```tsx
// frontend/src/components/refine/SceneReadView.tsx
import type { PipelineScene } from '../../api/pipeline'

/** Read-only render of a scene's body: action, tag chips, dialogue rows,
 *  narration list. Shared by the scene card, the re-parse proposal block, and
 *  the focus panel so all three render a scene identically. */
export function SceneReadView({ scene }: { scene: PipelineScene }) {
  const tags = [scene.location, scene.characters.join(', '), scene.mood].filter(Boolean)
  return (
    <div>
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
              <dd className="text-ink">
                {d.line}
                {d.emotion && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-xs text-[10px] bg-surface text-steel border border-hairline align-middle">
                    {d.emotion}{d.intensity ? ` · ${d.intensity}` : ''}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {scene.narration && scene.narration.length > 0 && (
        <div className="mt-2.5 border-t border-hairline pt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone mb-1">Narration</div>
          <ul className="space-y-1 text-xs text-steel italic leading-snug">
            {scene.narration.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Use `SceneReadView` in the card body**

In `frontend/src/components/refine/EditableSceneCard.tsx`, add the import at the top (after the existing imports):
```tsx
import { SceneReadView } from './SceneReadView'
```

Replace the card body — everything from the `{scene.action && (` block through the closing of the narration block (the three blocks rendering action, tags, dialogue, narration, i.e. lines ~57–96) — with a single:
```tsx
      <SceneReadView scene={scene} />
```
so the read view becomes: the header `<div>…</div>` (re-parse/edit buttons), then `<SceneReadView scene={scene} />`, then the `{proposal && (` block.

- [ ] **Step 3: Render the proposal readably**

In the same file, replace the proposal block's `<dl>…</dl>` (the `Object.entries(proposal.changes).map(...)` list, lines ~101–108) with a `SceneReadView` of the proposed scene:
```tsx
          <SceneReadView scene={{ ...scene, ...proposal.changes }} />
```
Keep the surrounding "Suggested" header, the `{proposal.rationale && …}` line, and the Accept/Reject buttons exactly as they are.

- [ ] **Step 4: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/refine/SceneReadView.tsx frontend/src/components/refine/EditableSceneCard.tsx
git commit -m "feat(refine): shared SceneReadView; readable re-parse proposal"
```

---

## Task 6: `RefineChat` accepts a seed draft

**Files:**
- Modify: `frontend/src/components/refine/RefineChat.tsx`

- [ ] **Step 1: Add the `seedDraft` prop**

In the `Props` interface, add:
```tsx
  seedDraft?: string
```

- [ ] **Step 2: Seed the composer when `seedDraft` changes**

Add `seedDraft` to the destructured props in the function body, and add an effect that fills the composer when a (non-empty) seed arrives. Add `useEffect` to the React import:
```tsx
import { useEffect, useMemo, useState } from 'react'
```
Then, after the `const [renameDraft, setRenameDraft] = useState('')` line, add:
```tsx
  useEffect(() => {
    if (seedDraft) setDraft(seedDraft)
  }, [seedDraft])
```

- [ ] **Step 3: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/refine/RefineChat.tsx
git commit -m "feat(refine): RefineChat seedDraft prop for prefilled mentions"
```

---

## Task 7: `SceneFocusPanel` modal

**Files:**
- Create: `frontend/src/components/refine/SceneFocusPanel.tsx`

- [ ] **Step 1: Create the panel**

```tsx
// frontend/src/components/refine/SceneFocusPanel.tsx
import { useEffect, useRef } from 'react'
import type { PipelineScene, ScenePatch, SceneSource } from '../../api/pipeline'
import { SceneReadView } from './SceneReadView'

interface Props {
  scene: PipelineScene
  proposal?: ScenePatch
  source: { loading: boolean; data: SceneSource | null; error: string }
  chapterText: string
  onClose: () => void
  onEdit: () => void
  onAcceptProposal: () => void
  onRejectProposal: () => void
  children: React.ReactNode   // the relocated RefineChat
}

function sceneLabel(sceneId: string): string {
  const m = sceneId.match(/_S(\d+)$/)
  return m ? `Scene ${m[1]}` : sceneId
}

export function SceneFocusPanel({
  scene, proposal, source, chapterText, onClose, onEdit,
  onAcceptProposal, onRejectProposal, children,
}: Props) {
  const firstMatchRef = useRef<HTMLDivElement | null>(null)

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Auto-scroll the source to the first matched line once it loads.
  useEffect(() => {
    if (source.data?.found) firstMatchRef.current?.scrollIntoView({ block: 'center' })
  }, [source.data])

  const matched = new Set(source.data?.match_lines ?? [])
  const lines = chapterText.split('\n')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={sceneLabel(scene.scene_id)}
        className="relative z-10 w-full max-w-5xl max-h-[85vh] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 rounded-lg border border-hairline bg-canvas p-5 overflow-hidden">

        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 text-stone hover:text-ink rounded-md px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
          ✕
        </button>

        {/* Left column: scene + source */}
        <div className="min-h-0 overflow-y-auto pr-1 space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-stone">{sceneLabel(scene.scene_id)}</span>
              <button onClick={onEdit}
                className="text-[11px] text-steel hover:text-ink transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">
                Edit
              </button>
            </div>
            <SceneReadView scene={scene} />
            {proposal && (
              <div className="mt-3 rounded-md border border-[#3772cf]/40 bg-[#3772cf]/5 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#3772cf] mb-1.5">Suggested</div>
                <SceneReadView scene={{ ...scene, ...proposal.changes }} />
                {proposal.rationale && <p className="text-[11px] text-steel mt-2 mb-2">{proposal.rationale}</p>}
                <div className="flex gap-2 mt-2">
                  <button onClick={onAcceptProposal}
                    className="px-2.5 py-1 rounded-md bg-[#3772cf] text-white text-[11px] font-medium hover:bg-[#2c5cab] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">Accept</button>
                  <button onClick={onRejectProposal}
                    className="px-2.5 py-1 rounded-md border border-hairline text-steel text-[11px] hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">Reject</button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-hairline pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-stone mb-1.5">Source text</div>
            {source.loading ? (
              <div className="space-y-1.5animate-pulse" aria-hidden="true">
                <div className="h-3 w-full rounded-xs bg-hairline" />
                <div className="h-3 w-5/6 rounded-xs bg-hairline" />
                <div className="h-3 w-4/6 rounded-xs bg-hairline" />
              </div>
            ) : source.error ? (
              <p className="text-xs text-brand-error">{source.error}</p>
            ) : (
              <>
                {source.data && !source.data.found && (
                  <p className="text-[11px] text-stone mb-1.5">Couldn't locate this scene in the source — showing the full chapter.</p>
                )}
                <pre className="text-xs text-steel font-mono whitespace-pre-wrap leading-relaxed">
                  {lines.map((ln, i) => {
                    const hit = matched.has(i)
                    return (
                      <div key={i} ref={hit && i === source.data?.line_start ? firstMatchRef : undefined}
                        className={hit ? 'border-l-2 border-[#3772cf] bg-[#3772cf]/5 pl-2 -ml-0.5 text-ink' : 'pl-2'}>
                        {ln || ' '}
                      </div>
                    )
                  })}
                </pre>
              </>
            )}
          </div>
        </div>

        {/* Right column: the relocated chat */}
        <div className="min-h-0 h-[60vh] lg:h-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds.

> Note: in Step 1 the loading skeleton class string `space-y-1.5animate-pulse` is a typo to avoid — write it as `space-y-1.5 animate-pulse` (two classes). Fix it now if present.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/SceneFocusPanel.tsx
git commit -m "feat(refine): SceneFocusPanel modal (scene + highlighted source + chat slot)"
```

---

## Task 8: Wire the panel into `ChapterView` + Focus button

**Files:**
- Modify: `frontend/src/components/refine/EditableSceneCard.tsx` (Focus button + prop)
- Modify: `frontend/src/studio/views/ChapterView.tsx`

- [ ] **Step 1: Add a Focus button to the card**

In `EditableSceneCard.tsx`, add `onFocus: () => void` to the `Props` interface, and destructure `onFocus` in the component args. In the read-mode header button group (the `<div className="flex items-center gap-2 shrink-0">`), add a Focus button before the Re-parse button:
```tsx
          <button
            onClick={onFocus}
            className="text-[11px] text-steel hover:text-ink transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          >
            Focus
          </button>
```

- [ ] **Step 2: Add focus + source state to ChapterView**

In `frontend/src/studio/views/ChapterView.tsx`, add to the imports:
```tsx
import { SceneFocusPanel } from '../../components/refine/SceneFocusPanel'
```
and extend the pipeline import to include `getSceneSource` and the `SceneSource` type:
```tsx
import {
  getChunkScenes, getChunkText, parseEpisode,
  saveScenes, saveText, resetScenes, resetText, reparseScene, getSceneSource,
  type PipelineScene, type ScenePatch, type TextCorrection, type SceneSource,
} from '../../api/pipeline'
```

Add state near the other scene state (after `const [reparseError, setReparseError] = useState('')`):
```tsx
  const [focusedSceneId, setFocusedSceneId] = useState<string | null>(null)
  const [sceneSource, setSceneSource] = useState<{ loading: boolean; data: SceneSource | null; error: string }>(
    { loading: false, data: null, error: '' })
```

- [ ] **Step 3: Fetch source when a scene is focused**

Add this effect after the existing effects (e.g. after the chat-abort cleanup effect):
```tsx
  // Fetch best-effort source location whenever a scene is focused.
  useEffect(() => {
    if (!focusedSceneId) return
    let alive = true
    setSceneSource({ loading: true, data: null, error: '' })
    getSceneSource(episodeId, chunkId, focusedSceneId)
      .then(data => { if (alive) setSceneSource({ loading: false, data, error: '' }) })
      .catch(e => { if (alive) setSceneSource({ loading: false, data: null, error: `Couldn't load source: ${String(e)}` }) })
    return () => { alive = false }
  }, [focusedSceneId, episodeId, chunkId])
```

- [ ] **Step 4: Compute the chat seed and extract the chat element**

The chat must be a single instance that lives either in the sidebar or in the panel. Just above the `return (`, build the seed and the shared chat element:
```tsx
  const focusedScene = scenes.find(s => s.scene_id === focusedSceneId) ?? null
  const seedDraft = focusedScene
    ? `@Scene${(focusedScene.scene_id.match(/_S(\d+)$/)?.[1] ?? '').replace(/^0+(?=\d)/, '')} `
    : ''

  const chatEl = (
    <RefineChat
      messages={messages}
      streaming={streaming}
      streamReply={streamReply}
      streamThinking={streamThinking}
      thinkingEnabled={thinkingEnabled}
      usage={usage}
      error={chatError}
      sceneIds={scenes.map(s => s.scene_id)}
      seedDraft={seedDraft}
      sessions={sessions}
      activeSessionId={activeSessionId}
      onToggleThinking={() => setThinkingEnabled(v => !v)}
      onSend={onSend}
      onAbort={onAbortChat}
      onRetry={onRetryChat}
      onNewChat={onNewChat}
      onSelectSession={onSelectSession}
      onRenameSession={onRenameSession}
      onDeleteSession={onDeleteSession}
    />
  )
```
> Note: `@Scene` uses the un-padded scene number to match what the composer suggestions and `parseMentions` accept (`@Scene3`, `@Scene12`). The regex strips leading zeros from `S03` → `3`.

- [ ] **Step 5: Render the chat from the shared element + add the panel**

Replace the sidebar block:
```tsx
        <div className="lg:sticky lg:top-6 h-[70vh]">
          <RefineChat
            messages={messages}
            …all props…
          />
        </div>
```
with (render the shared element only when NOT focused, so it isn't mounted twice):
```tsx
        <div className="lg:sticky lg:top-6 h-[70vh]">
          {!focusedSceneId && chatEl}
        </div>
```

Add the `onFocus` wiring to the `EditableSceneCard` usage:
```tsx
                      onReparse={() => onReparseScene(s.scene_id)}
                      reparsing={reparsing.has(s.scene_id)}
                      onFocus={() => setFocusedSceneId(s.scene_id)}
```

Just before the final closing `</div>` of the component's returned JSX (after the "Episode insights" `</section>`), add the panel:
```tsx
      {focusedScene && (
        <SceneFocusPanel
          scene={focusedScene}
          proposal={proposals[focusedScene.scene_id]}
          source={sceneSource}
          chapterText={text}
          onClose={() => setFocusedSceneId(null)}
          onEdit={() => { setEditing(prev => new Set(prev).add(focusedScene.scene_id)); setFocusedSceneId(null) }}
          onAcceptProposal={() => acceptProposal(focusedScene.scene_id)}
          onRejectProposal={() => rejectProposal(focusedScene.scene_id)}
        >
          {chatEl}
        </SceneFocusPanel>
      )}
```

- [ ] **Step 6: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds, no TS errors (unused-var, missing-prop, etc.).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/refine/EditableSceneCard.tsx frontend/src/studio/views/ChapterView.tsx
git commit -m "feat(refine): per-scene Focus panel wired into ChapterView"
```

---

## Task 9: ui-taste pass + full verification

**Files:** (review only; fix inline where the smell test fails)
- `frontend/src/components/refine/SceneReadView.tsx`
- `frontend/src/components/refine/SceneFocusPanel.tsx`
- `frontend/src/studio/views/ChapterView.tsx`

- [ ] **Step 1: Run the `ui-taste` skill** and apply its smell test to the new panel, Focus button, and highlighted-source rendering: one accent (`#3772cf`), token-only spacing/radius/color (no stray hex or `[..px]` beyond the established `text-[11px]` etc. already used in this codebase), real loading / empty / no-match / error states (present), focus-visible rings on Focus, Close, Accept/Reject (present), restrained motion, no emoji used as content/placeholder (the `✕` close glyph is a control label, acceptable; replace if the skill objects). Fix anything that fails.

- [ ] **Step 2: Backend test suite**

Run: `python -m pytest tests/ -q`
Expected: PASS (all tests, including the new `test_scene_source.py` and the appended route/engine tests).

- [ ] **Step 3: Frontend tests + build**

Run (from `frontend/`): `npm run test -- --run` then `npm run build`
Expected: vitest passes; build succeeds.

- [ ] **Step 4: Manual smoke (preview tools)**

Start the dev server and verify the flow renders: open a parsed chapter → click **Focus** on a scene → panel shows the scene readably, the source with highlighted lines (or the no-match notice), and the chat with `@SceneN ` pre-filled. Confirm `Esc`/scrim closes it and the sidebar chat returns. Capture a screenshot as proof.

- [ ] **Step 5: Commit any ui-taste fixes**

```bash
git add -A
git commit -m "polish(refine): ui-taste pass on Scene Focus panel"
```

---

## Self-Review notes

- **Spec coverage:** §2 locator → Task 1; §3.1 source endpoint → Task 2; §3.2 `@Scene` source in chat → Task 3; §4.1 client → Task 4; §4.2 `SceneReadView` + proposal fix → Task 5; §4.3 panel → Tasks 6–7; §4.4 ChapterView wiring (focus state, source fetch, seed, single chat) → Task 8; §4.5 ui-taste → Task 9. All covered.
- **One-leading-system-message invariant** (from the earlier 500 fix) is re-asserted by `test_build_messages_injects_source_passage_for_mentioned_scene` (Task 3).
- **Type consistency:** `SceneSource` shape is identical across backend (`scene_source.SceneSource`), the endpoint JSON, the TS `SceneSource` interface, and `getSceneSource`. `seedDraft` prop name matches between Task 6 (definition) and Task 8 (use). `onFocus` matches between Task 8 Step 1 (prop) and Step 5 (wiring).
- **Single chat instance:** `chatEl` is rendered in exactly one place at a time (`{!focusedSceneId && chatEl}` in sidebar, else inside the panel) — never mounted twice, so chat state/stream is preserved across open/close.
