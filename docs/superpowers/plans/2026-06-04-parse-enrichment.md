# Parse Enrichment (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the per-chunk scene parse so each pass emits emotion-tagged character dialogue, a parser-detected narration list, and proper nouns normalized against a per-episode canonical-entity registry (auto-grown + user-editable); plus a derived character voice-profile view.

**Architecture:** A new pure `entity_registry` module (file-backed `processed/{episode_id}/entities.json`) is consulted and updated inside `parse_chunk`. The parse prompt gains emotion/intensity/narration fields and a "known names" hint. A new pure `voice_profiles` aggregation module powers a derived endpoint. Pydantic models and frontend types gain the new fields (all optional/defaulted → backward compatible). New frontend panels edit the registry and show voice profiles.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 / httpx / pytest-asyncio (asyncio_mode=auto); React 18 / Vite / TypeScript / Tailwind 3 / Vitest (node env, fetch-mock — no DOM lib).

**Spec:** `docs/superpowers/specs/2026-06-04-parse-enrichment-design.md`

**Branch:** `feat/parse-enrichment` (already created).

---

## File Structure

**Backend**
- Create `animatory/entity_registry.py` — pure registry: `EntityRegistry` class (`known_names`, `normalize_scene`, `learn`, `to_dict`/`from_dict`) + `load`/`save`.
- Create `animatory/voice_profiles.py` — pure `aggregate(scenes) -> list[dict]`.
- Modify `animatory/scene_parser.py` — `EMOTIONS`/`INTENSITIES` constants, enriched prompt, registry integration in `parse_chunk`.
- Modify `animatory/pipeline_router.py` — model fields (`SceneDialogueModel`, `SceneModel`), entity routes (GET/PUT), voice-profiles route.
- Create `tests/test_entity_registry.py`, `tests/test_voice_profiles.py`; extend `tests/test_scene_parser.py`, `tests/test_pipeline_api.py`.

**Frontend**
- Modify `frontend/src/api/pipeline.ts` — `SceneDialogue`/`PipelineScene` fields, `EMOTIONS`/`INTENSITIES`, entity + voice-profile types and clients.
- Create `frontend/src/components/refine/entities.ts` — pure `parseAliases` helper.
- Modify `frontend/src/components/SceneList.tsx`, `frontend/src/components/refine/EditableSceneCard.tsx` — emotion chips + narration (read) and emotion/intensity/narration (edit).
- Create `frontend/src/components/refine/EntityRegistryPanel.tsx`, `frontend/src/components/refine/VoiceProfilePanel.tsx`.
- Modify `frontend/src/studio/views/ChapterView.tsx` — wire both panels.
- Extend `frontend/src/api/pipeline.test.ts`; create `frontend/src/components/refine/entities.test.ts`.

---

## Task B-T1: entity_registry module — model, load, save, known_names

**Files:**
- Create: `animatory/entity_registry.py`
- Test: `tests/test_entity_registry.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_entity_registry.py
from __future__ import annotations

import json

from animatory import entity_registry as er


def test_load_missing_returns_empty(tmp_path):
    reg = er.load("ep1", tmp_path)
    assert reg.episode_id == "ep1"
    assert reg.characters == []
    assert reg.locations == []


def test_save_then_load_round_trip(tmp_path):
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
        locations=[{"canonical": "Cao's Palace", "aliases": []}],
    )
    path = er.save(reg, tmp_path, now="2026-06-04T00:00:00Z")
    assert path == tmp_path / "entities.json"
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["updated_at"] == "2026-06-04T00:00:00Z"

    reloaded = er.load("ep1", tmp_path)
    assert reloaded.characters[0]["canonical"] == "Đại Càn"
    assert reloaded.locations[0]["canonical"] == "Cao's Palace"


def test_known_names_lists_canonicals(tmp_path):
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Tư An", "aliases": []}],
        locations=[{"canonical": "Palace", "aliases": []}],
    )
    known = reg.known_names()
    assert known == {"characters": ["Tư An"], "locations": ["Palace"]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_entity_registry.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'animatory.entity_registry'`

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/entity_registry.py
from __future__ import annotations

import json
import unicodedata
from pathlib import Path


def _key(name: str) -> str:
    """Case-insensitive, diacritic-significant match key for a proper noun.

    NFC-normalize, collapse internal whitespace, strip, casefold. Diacritics are
    intentionally preserved so distinct Vietnamese names are not merged.
    """
    nfc = unicodedata.normalize("NFC", name)
    return " ".join(nfc.split()).casefold()


class EntityRegistry:
    def __init__(
        self,
        episode_id: str,
        characters: list[dict] | None = None,
        locations: list[dict] | None = None,
        updated_at: str | None = None,
    ) -> None:
        self.episode_id = episode_id
        self.characters: list[dict] = characters or []
        self.locations: list[dict] = locations or []
        self.updated_at = updated_at

    def to_dict(self) -> dict:
        return {
            "episode_id": self.episode_id,
            "updated_at": self.updated_at,
            "characters": self.characters,
            "locations": self.locations,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EntityRegistry":
        return cls(
            episode_id=d.get("episode_id", ""),
            characters=d.get("characters", []),
            locations=d.get("locations", []),
            updated_at=d.get("updated_at"),
        )

    def known_names(self) -> dict:
        return {
            "characters": [e["canonical"] for e in self.characters],
            "locations": [e["canonical"] for e in self.locations],
        }


def _path(episode_dir: Path) -> Path:
    return episode_dir / "entities.json"


def load(episode_id: str, episode_dir: Path) -> EntityRegistry:
    p = _path(episode_dir)
    if not p.exists():
        return EntityRegistry(episode_id=episode_id)
    return EntityRegistry.from_dict(json.loads(p.read_text(encoding="utf-8")))


def save(registry: EntityRegistry, episode_dir: Path, *, now: str) -> Path:
    registry.updated_at = now
    p = _path(episode_dir)
    p.write_text(
        json.dumps(registry.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return p
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_entity_registry.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add animatory/entity_registry.py tests/test_entity_registry.py
git commit -m "feat(parse): entity registry model + load/save/known_names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T2: entity_registry.normalize_scene

**Files:**
- Modify: `animatory/entity_registry.py` (add method to `EntityRegistry`)
- Test: `tests/test_entity_registry.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_entity_registry.py

def _reg():
    return er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
        locations=[{"canonical": "Cao's Palace", "aliases": ["cao palace"]}],
    )


def test_normalize_scene_maps_alias_to_canonical():
    scene = {
        "scene_id": "C001_S01",
        "location": "cao palace",
        "characters": ["đại cản", "Tư An"],
        "dialogue": [
            {"character": "đại cản", "line": "Quỳ xuống.", "emotion": "commanding"},
        ],
        "action": "đại cản bước vào",  # free prose — must NOT be touched
    }
    out = _reg().normalize_scene(scene)
    assert out["location"] == "Cao's Palace"
    assert out["characters"] == ["Đại Càn", "Tư An"]
    assert out["dialogue"][0]["character"] == "Đại Càn"
    assert out["dialogue"][0]["emotion"] == "commanding"  # preserved
    assert out["action"] == "đại cản bước vào"  # prose untouched


def test_normalize_scene_is_case_insensitive_diacritic_significant():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Tư An", "aliases": []}],
    )
    scene = {"characters": ["TƯ AN", "Tu An"], "dialogue": [], "location": ""}
    out = reg.normalize_scene(scene)
    # "TƯ AN" matches canonical case-insensitively; "Tu An" (no diacritics) does not.
    assert out["characters"] == ["Tư An", "Tu An"]


def test_normalize_scene_does_not_mutate_input():
    scene = {"location": "cao palace", "characters": [], "dialogue": []}
    _reg().normalize_scene(scene)
    assert scene["location"] == "cao palace"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_entity_registry.py -q`
Expected: FAIL — `AttributeError: 'EntityRegistry' object has no attribute 'normalize_scene'`

- [ ] **Step 3: Write minimal implementation**

Add these methods inside the `EntityRegistry` class (after `known_names`):

```python
    def _alias_map(self, entries: list[dict]) -> dict:
        m: dict[str, str] = {}
        for e in entries:
            canonical = e["canonical"]
            m[_key(canonical)] = canonical
            for a in e.get("aliases", []):
                m[_key(a)] = canonical
        return m

    def normalize_scene(self, scene: dict) -> dict:
        """Return a copy of *scene* with structured proper-noun fields mapped to
        canonical spellings. Only ``location``, ``characters[]`` and
        ``dialogue[].character`` are touched — free prose is never altered."""
        char_map = self._alias_map(self.characters)
        loc_map = self._alias_map(self.locations)

        def canon(name: str, m: dict) -> str:
            return m.get(_key(name), name) if isinstance(name, str) else name

        scene = dict(scene)
        if isinstance(scene.get("location"), str):
            scene["location"] = canon(scene["location"], loc_map)
        if isinstance(scene.get("characters"), list):
            scene["characters"] = [canon(c, char_map) for c in scene["characters"]]
        if isinstance(scene.get("dialogue"), list):
            scene["dialogue"] = [
                {**d, "character": canon(d["character"], char_map)}
                if isinstance(d, dict) and "character" in d
                else d
                for d in scene["dialogue"]
            ]
        return scene
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_entity_registry.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add animatory/entity_registry.py tests/test_entity_registry.py
git commit -m "feat(parse): deterministic normalize_scene on structured fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T3: entity_registry.learn

**Files:**
- Modify: `animatory/entity_registry.py` (add method to `EntityRegistry`)
- Test: `tests/test_entity_registry.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_entity_registry.py

def test_learn_adds_new_names_only():
    reg = er.EntityRegistry(
        episode_id="ep1",
        characters=[{"canonical": "Tư An", "aliases": ["tu an"]}],
    )
    scenes = [
        {
            "location": "Garden",
            "characters": ["Tư An", "Lan Nhi"],   # Tư An known; Lan Nhi new
            "dialogue": [{"character": "tu an", "line": "x"},   # alias → known
                         {"character": "Bà Mối", "line": "y"}], # new via dialogue
        }
    ]
    reg.learn(scenes)
    char_canon = {e["canonical"] for e in reg.characters}
    loc_canon = {e["canonical"] for e in reg.locations}
    assert char_canon == {"Tư An", "Lan Nhi", "Bà Mối"}
    assert loc_canon == {"Garden"}


def test_learn_is_idempotent():
    reg = er.EntityRegistry(episode_id="ep1")
    scenes = [{"location": "Hall", "characters": ["A"], "dialogue": []}]
    reg.learn(scenes)
    reg.learn(scenes)
    assert len(reg.characters) == 1
    assert len(reg.locations) == 1


def test_learn_ignores_blank_names():
    reg = er.EntityRegistry(episode_id="ep1")
    reg.learn([{"location": "", "characters": ["", "  "], "dialogue": []}])
    assert reg.characters == []
    assert reg.locations == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_entity_registry.py -q`
Expected: FAIL — `AttributeError: 'EntityRegistry' object has no attribute 'learn'`

- [ ] **Step 3: Write minimal implementation**

Add inside the `EntityRegistry` class (after `normalize_scene`):

```python
    def learn(self, scenes: list[dict]) -> "EntityRegistry":
        """Add genuinely-new character/location names to the registry. A name is
        new only if its key matches no existing canonical or alias. Idempotent."""
        char_keys = {_key(e["canonical"]) for e in self.characters}
        char_keys |= {_key(a) for e in self.characters for a in e.get("aliases", [])}
        loc_keys = {_key(e["canonical"]) for e in self.locations}
        loc_keys |= {_key(a) for e in self.locations for a in e.get("aliases", [])}

        def add(name: str, entries: list[dict], keys: set[str]) -> None:
            if not isinstance(name, str) or not name.strip():
                return
            k = _key(name)
            if k in keys:
                return
            entries.append({"canonical": name.strip(), "aliases": []})
            keys.add(k)

        for s in scenes:
            add(s.get("location", ""), self.locations, loc_keys)
            for c in s.get("characters", []) or []:
                add(c, self.characters, char_keys)
            for d in s.get("dialogue", []) or []:
                if isinstance(d, dict):
                    add(d.get("character", ""), self.characters, char_keys)
        return self
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_entity_registry.py -q`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add animatory/entity_registry.py tests/test_entity_registry.py
git commit -m "feat(parse): entity_registry.learn auto-grows new names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T4: Pydantic model fields (emotion, intensity, narration)

**Files:**
- Modify: `animatory/pipeline_router.py:152-164`
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_pipeline_api.py
from animatory.pipeline_router import SceneModel, SceneDialogueModel


def test_scene_model_defaults_narration_and_optional_emotion():
    # Old-shaped scene (no narration / emotion) still validates.
    s = SceneModel(
        scene_id="C001_S01",
        location="Hall",
        characters=["A"],
        shot_type="wide",
        action="x",
        dialogue=[{"character": "A", "line": "hi"}],
        mood="tense",
    )
    assert s.narration == []
    assert s.dialogue[0].emotion is None
    assert s.dialogue[0].intensity is None


def test_scene_model_accepts_enriched_fields():
    s = SceneModel(
        scene_id="C001_S01",
        location="Hall",
        characters=["A"],
        shot_type="wide",
        action="x",
        dialogue=[{"character": "A", "line": "hi", "emotion": "angry", "intensity": "high"}],
        mood="tense",
        narration=["Đêm xuống."],
    )
    assert s.narration == ["Đêm xuống."]
    assert s.dialogue[0].emotion == "angry"
    assert s.dialogue[0].intensity == "high"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_pipeline_api.py -q -k scene_model`
Expected: FAIL — `TypeError`/`ValidationError` (narration/emotion not accepted)

- [ ] **Step 3: Write minimal implementation**

Replace `animatory/pipeline_router.py` lines 152-164:

```python
class SceneDialogueModel(BaseModel):
    character: str
    line: str
    emotion: str | None = None
    intensity: str | None = None


class SceneModel(BaseModel):
    scene_id: str
    location: str
    characters: list[str]
    shot_type: str
    action: str
    dialogue: list[SceneDialogueModel]
    mood: str
    narration: list[str] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_pipeline_api.py -q -k scene_model`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(parse): add emotion/intensity/narration to scene models

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T5: Enriched parse prompt + registry integration in parse_chunk

**Files:**
- Modify: `animatory/scene_parser.py:19-42` (constants + prompt) and `:45-128` (`parse_chunk`)
- Test: `tests/test_scene_parser.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_scene_parser.py (reuse _make_mock_response from this file)
from animatory import entity_registry as er

ENRICHED_RESPONSE = {
    "chunk_id": "C001",
    "scenes": [
        {
            "scene_id": "C001_S01",
            "location": "cao palace",
            "characters": ["đại cản"],
            "shot_type": "wide",
            "action": "đại cản bước vào",
            "dialogue": [{"character": "đại cản", "line": "Quỳ.", "emotion": "commanding", "intensity": "high"}],
            "narration": ["Đêm xuống."],
            "mood": "tense",
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
        out = await parse_chunk("C001", "text", "ep1", tmp_path)

    scene = json.loads(out.read_text(encoding="utf-8"))["scenes"][0]
    # normalized structured fields:
    assert scene["location"] == "Cao's Palace"
    assert scene["characters"] == ["Đại Càn"]
    assert scene["dialogue"][0]["character"] == "Đại Càn"
    # enriched fields persisted:
    assert scene["dialogue"][0]["emotion"] == "commanding"
    assert scene["narration"] == ["Đêm xuống."]
    # free prose untouched:
    assert scene["action"] == "đại cản bước vào"

    # registry was saved (alias already known → no duplicate canonical added):
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
    assert "commanding" in prompt          # emotion vocab present
    assert "narration" in prompt           # narration instruction present
    assert "Tư An" in prompt               # known name injected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_scene_parser.py -q -k "normalizes or known_names"`
Expected: FAIL — normalized values / new keys not present (registry not yet wired; prompt lacks fields)

- [ ] **Step 3: Write minimal implementation**

In `animatory/scene_parser.py`, add the import near the top (after `import httpx`):

```python
from animatory import entity_registry
```

Replace the prompt block (lines 19-42) with the constants + enriched template:

```python
EMOTIONS = [
    "neutral", "happy", "sad", "angry", "fearful", "surprised",
    "tender", "mocking", "commanding", "anxious", "determined", "disgusted",
]
INTENSITIES = ["low", "medium", "high"]

_PROMPT_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Extract a complete shot list from the following chapter text.
Return ONLY valid JSON matching this schema - no explanation, no markdown:

{{
  "chunk_id": "{chunk_id}",
  "scenes": [
    {{
      "scene_id": "{chunk_id}_S01",
      "location": "string",
      "characters": ["string"],
      "shot_type": "wide | medium | close-up | insert | POV",
      "action": "string",
      "dialogue": [
        {{"character": "string", "line": "string", "emotion": "one of: {emotions}", "intensity": "low | medium | high"}}
      ],
      "narration": ["string"],
      "mood": "string"
    }}
  ]
}}

Rules:
- "dialogue" holds ONLY lines spoken aloud by a named character. Choose "emotion"
  from the listed set (omit it if genuinely unclear); "intensity" is optional.
- "narration" is narrator / voice-over prose NOT spoken by any character
  (descriptions, scene-setting). Detect it and put each narration sentence as a
  string in "narration". Do NOT invent a "Narrator" character.
- Known names — use EXACTLY these spellings wherever they appear:
  characters: {known_characters}
  locations: {known_locations}

Chapter text:
---
{chunk_text}
---"""
```

In `parse_chunk`, replace the prompt construction line (currently
`prompt = _PROMPT_TEMPLATE.format(chunk_id=chunk_id, chunk_text=chunk_text)`) with
a registry load + enriched format. Insert directly **before** `payload = {`:

```python
    registry = entity_registry.load(episode_id, output_dir)
    known = registry.known_names()
    prompt = _PROMPT_TEMPLATE.format(
        chunk_id=chunk_id,
        chunk_text=chunk_text,
        emotions=", ".join(EMOTIONS),
        known_characters=", ".join(known["characters"]) or "(none yet)",
        known_locations=", ".join(known["locations"]) or "(none yet)",
    )
```

Then, after the parse loop succeeds (replace the result-building block at lines
118-127, i.e. from `out_path = output_dir / ...` through the
`out_path.write_text(...)`/`return`), normalize + learn + save the registry:

```python
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

(`datetime` and `timezone` are already imported at the top of the file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_scene_parser.py -q`
Expected: PASS (all existing scene_parser tests + 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add animatory/scene_parser.py tests/test_scene_parser.py
git commit -m "feat(parse): enrich prompt + normalize/learn registry in parse_chunk

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T6: Entity registry routes (GET/PUT)

**Files:**
- Modify: `animatory/pipeline_router.py` (add models near line 168; routes after the scenes routes, before the chat routes)
- Test: `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_pipeline_api.py
import io

TINY_TXT = ("Một câu chuyện nhỏ. " * 60).encode("utf-8")


async def _chunk_episode(client, tmp_path, monkeypatch, ep="enttest"):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    files = {"file": (f"{ep}.txt", io.BytesIO(TINY_TXT), "text/plain")}
    r = await client.post(f"/pipeline/chunk?episode_id={ep}", files=files)
    assert r.status_code == 200
    return ep


@pytest.mark.asyncio
async def test_entities_get_empty_then_put_round_trip(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch)

    r = await client.get(f"/pipeline/episodes/{ep}/entities")
    assert r.status_code == 200
    assert r.json()["characters"] == []

    body = {
        "characters": [{"canonical": "Đại Càn", "aliases": ["đại cản"]}],
        "locations": [{"canonical": "Cao's Palace", "aliases": []}],
    }
    r = await client.put(f"/pipeline/episodes/{ep}/entities", json=body)
    assert r.status_code == 200
    assert r.json()["characters"][0]["canonical"] == "Đại Càn"

    r = await client.get(f"/pipeline/episodes/{ep}/entities")
    assert r.json()["characters"][0]["aliases"] == ["đại cản"]


@pytest.mark.asyncio
async def test_entities_404_for_unknown_episode(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ANIMATORY_PROCESSED_DIR", str(tmp_path))
    r = await client.get("/pipeline/episodes/nope/entities")
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_pipeline_api.py -q -k entities`
Expected: FAIL — 404/405 (routes don't exist)

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `animatory/pipeline_router.py` (with the other
`from animatory...` imports):

```python
from animatory import entity_registry
from animatory.voice_profiles import aggregate
```

(`voice_profiles` is created in B-T7; add both imports now and B-T7's test will
exercise `aggregate`. If running tasks strictly in order, create an empty
`animatory/voice_profiles.py` with `def aggregate(scenes): return []` as a stub —
B-T7 replaces it. Otherwise add the `aggregate` import in B-T7.)

Add request models after `class SaveScenesRequest` (line 168):

```python
class AliasEntry(BaseModel):
    canonical: str
    aliases: list[str] = []


class EntityRegistryRequest(BaseModel):
    characters: list[AliasEntry] = []
    locations: list[AliasEntry] = []
```

Add routes after `reset_chunk_scenes` (after line 365), before the text routes:

```python
@router.get("/episodes/{episode_id}/entities")
async def get_entities(episode_id: str):
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")
    return entity_registry.load(episode_id, ep_dir).to_dict()


@router.put("/episodes/{episode_id}/entities")
async def save_entities(episode_id: str, body: EntityRegistryRequest):
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")
    reg = entity_registry.EntityRegistry(
        episode_id=episode_id,
        characters=[e.model_dump() for e in body.characters],
        locations=[e.model_dump() for e in body.locations],
    )
    entity_registry.save(reg, ep_dir, now=_now())
    logger.info("[entities] episode=%s saved %d character(s), %d location(s)",
                episode_id, len(reg.characters), len(reg.locations))
    return reg.to_dict()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_pipeline_api.py -q -k entities`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add animatory/pipeline_router.py tests/test_pipeline_api.py
git commit -m "feat(parse): entity registry GET/PUT routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T7: Voice-profile aggregation + route

**Files:**
- Create: `animatory/voice_profiles.py`
- Modify: `animatory/pipeline_router.py` (add route after entity routes; import already added in B-T6)
- Test: `tests/test_voice_profiles.py`, `tests/test_pipeline_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_voice_profiles.py
from animatory.voice_profiles import aggregate


def test_aggregate_counts_emotions_per_character():
    scenes = [
        {"dialogue": [
            {"character": "A", "line": "x", "emotion": "angry", "intensity": "high"},
            {"character": "A", "line": "y", "emotion": "angry", "intensity": "low"},
            {"character": "B", "line": "z", "emotion": "happy"},
        ]},
        {"dialogue": [
            {"character": "A", "line": "w", "emotion": "neutral", "intensity": "high"},
        ]},
    ]
    profiles = aggregate(scenes)
    a = next(p for p in profiles if p["character"] == "A")
    assert a["line_count"] == 3
    assert a["emotions"] == {"angry": 2, "neutral": 1}
    assert a["dominant_emotion"] == "angry"
    assert a["dominant_intensity"] == "high"
    # sorted by line_count desc → A before B
    assert profiles[0]["character"] == "A"


def test_aggregate_handles_missing_emotion_and_empty():
    assert aggregate([]) == []
    profiles = aggregate([{"dialogue": [{"character": "A", "line": "x"}]}])
    assert profiles[0]["emotions"] == {}
    assert profiles[0]["dominant_emotion"] is None
    assert profiles[0]["dominant_intensity"] is None
```

```python
# append to tests/test_pipeline_api.py — route test
@pytest.mark.asyncio
async def test_voice_profiles_route_aggregates_scenes(client, tmp_path, monkeypatch):
    ep = await _chunk_episode(client, tmp_path, monkeypatch, ep="vptest")
    # write a parsed scenes file by hand under the episode dir
    import json as _json
    ep_dir = tmp_path / ep
    manifest = _json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    cid = manifest["chunks"][0]["chunk_id"]
    (ep_dir / f"{cid}_scenes.json").write_text(_json.dumps({
        "chunk_id": cid, "scenes": [
            {"scene_id": f"{cid}_S01", "dialogue": [
                {"character": "Tư An", "line": "x", "emotion": "angry"}]}]
    }), encoding="utf-8")

    r = await client.get(f"/pipeline/episodes/{ep}/voice-profiles")
    assert r.status_code == 200
    profiles = r.json()["profiles"]
    assert profiles[0]["character"] == "Tư An"
    assert profiles[0]["dominant_emotion"] == "angry"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_voice_profiles.py tests/test_pipeline_api.py -q -k "aggregate or voice_profiles"`
Expected: FAIL — module/route missing (or stub returns `[]`)

- [ ] **Step 3: Write minimal implementation**

```python
# animatory/voice_profiles.py
from __future__ import annotations

from collections import Counter


def aggregate(scenes: list[dict]) -> list[dict]:
    """Derive per-character emotion stats across *scenes* (already-loaded shot
    lists). Pure — no I/O. Profiles are sorted by line_count descending."""
    counts: dict[str, int] = {}
    emotions: dict[str, Counter] = {}
    intensities: dict[str, Counter] = {}
    order: list[str] = []

    for s in scenes:
        for d in s.get("dialogue", []) or []:
            if not isinstance(d, dict):
                continue
            name = d.get("character")
            if not name:
                continue
            if name not in counts:
                counts[name] = 0
                emotions[name] = Counter()
                intensities[name] = Counter()
                order.append(name)
            counts[name] += 1
            if d.get("emotion"):
                emotions[name][d["emotion"]] += 1
            if d.get("intensity"):
                intensities[name][d["intensity"]] += 1

    profiles = [
        {
            "character": name,
            "line_count": counts[name],
            "emotions": dict(emotions[name]),
            "dominant_emotion": emotions[name].most_common(1)[0][0] if emotions[name] else None,
            "dominant_intensity": intensities[name].most_common(1)[0][0] if intensities[name] else None,
        }
        for name in order
    ]
    profiles.sort(key=lambda p: p["line_count"], reverse=True)
    return profiles
```

Add the route in `animatory/pipeline_router.py` after `save_entities`:

```python
@router.get("/episodes/{episode_id}/voice-profiles")
async def get_voice_profiles(episode_id: str):
    ep_dir = _processed_dir() / episode_id
    if not (ep_dir / "manifest.json").exists():
        raise HTTPException(status_code=404, detail=f"Episode '{episode_id}' not found or not chunked yet")
    manifest = json.loads((ep_dir / "manifest.json").read_text(encoding="utf-8"))
    all_scenes: list[dict] = []
    for c in manifest.get("chunks", []):
        doc = _scenes_payload(ep_dir, c["chunk_id"])
        if doc:
            all_scenes.extend(doc.get("scenes", []))
    return {"episode_id": episode_id, "profiles": aggregate(all_scenes)}
```

(If a stub `voice_profiles.py` was created in B-T6, this step replaces it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_voice_profiles.py tests/test_pipeline_api.py -q`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest tests/ -q`
Expected: PASS (all prior + new tests)

- [ ] **Step 6: Commit**

```bash
git add animatory/voice_profiles.py animatory/pipeline_router.py tests/test_voice_profiles.py tests/test_pipeline_api.py
git commit -m "feat(parse): derived voice-profile aggregation + route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T8: Frontend API — types, constants, clients

**Files:**
- Modify: `frontend/src/api/pipeline.ts`
- Test: `frontend/src/api/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// append to frontend/src/api/pipeline.test.ts
import { getEntities, saveEntities, getVoiceProfiles, EMOTIONS } from './pipeline'

describe('parse-enrichment clients', () => {
  it('EMOTIONS exposes the controlled vocab', () => {
    expect(EMOTIONS).toContain('commanding')
    expect(EMOTIONS).toContain('neutral')
  })

  it('getEntities GETs the entities route', async () => {
    const f = mockFetch({ episode_id: 'ep1', characters: [], locations: [] })
    vi.stubGlobal('fetch', f)
    const reg = await getEntities('ep1')
    expect(reg.characters).toEqual([])
    expect(f.mock.calls[0][0]).toContain('/pipeline/episodes/ep1/entities')
  })

  it('saveEntities PUTs characters + locations', async () => {
    const f = mockFetch({ episode_id: 'ep1', characters: [{ canonical: 'X', aliases: [] }], locations: [] })
    vi.stubGlobal('fetch', f)
    const reg = await saveEntities('ep1', { characters: [{ canonical: 'X', aliases: [] }], locations: [] })
    expect(reg.characters[0].canonical).toBe('X')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/entities')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body).characters[0].canonical).toBe('X')
  })

  it('getVoiceProfiles GETs the voice-profiles route', async () => {
    const f = mockFetch({ episode_id: 'ep1', profiles: [{ character: 'A', line_count: 2, emotions: { angry: 2 }, dominant_emotion: 'angry', dominant_intensity: 'high' }] })
    vi.stubGlobal('fetch', f)
    const res = await getVoiceProfiles('ep1')
    expect(res.profiles[0].character).toBe('A')
    expect(f.mock.calls[0][0]).toContain('/pipeline/episodes/ep1/voice-profiles')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm test -- pipeline`
Expected: FAIL — `getEntities`/`EMOTIONS` not exported

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api/pipeline.ts`, update `SceneDialogue` and `PipelineScene`:

```typescript
export const EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised',
  'tender', 'mocking', 'commanding', 'anxious', 'determined', 'disgusted',
] as const
export const INTENSITIES = ['low', 'medium', 'high'] as const

export interface SceneDialogue {
  character: string
  line: string
  emotion?: string | null
  intensity?: string | null
}

export interface PipelineScene {
  scene_id: string
  location: string
  characters: string[]
  shot_type: string
  action: string
  dialogue: SceneDialogue[]
  mood: string
  narration?: string[]
}
```

Append new types + clients at the end of the file:

```typescript
export interface EntityEntry {
  canonical: string
  aliases: string[]
}

export interface EntityRegistry {
  episode_id: string
  updated_at: string | null
  characters: EntityEntry[]
  locations: EntityEntry[]
}

export interface VoiceProfile {
  character: string
  line_count: number
  emotions: Record<string, number>
  dominant_emotion: string | null
  dominant_intensity: string | null
}

export interface VoiceProfilesResult {
  episode_id: string
  profiles: VoiceProfile[]
}

function episodeBase(episodeId: string): string {
  return `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}`
}

export async function getEntities(episodeId: string): Promise<EntityRegistry> {
  const res = await fetch(`${episodeBase(episodeId)}/entities`)
  return jsonOrThrow<EntityRegistry>(res, 'getEntities')
}

export async function saveEntities(
  episodeId: string,
  body: { characters: EntityEntry[]; locations: EntityEntry[] },
): Promise<EntityRegistry> {
  const res = await fetch(`${episodeBase(episodeId)}/entities`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<EntityRegistry>(res, 'saveEntities')
}

export async function getVoiceProfiles(episodeId: string): Promise<VoiceProfilesResult> {
  const res = await fetch(`${episodeBase(episodeId)}/voice-profiles`)
  return jsonOrThrow<VoiceProfilesResult>(res, 'getVoiceProfiles')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npm test -- pipeline`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/pipeline.ts frontend/src/api/pipeline.test.ts
git commit -m "feat(parse): frontend types + clients for entities & voice profiles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T9: Scene cards — emotion chips + narration (display + edit)

**Files:**
- Modify: `frontend/src/components/SceneList.tsx`, `frontend/src/components/refine/EditableSceneCard.tsx`

> **UI task — invoke the `ui-taste` skill before writing JSX.** One accent `#3772cf`; token-only color/spacing/radius; emotion chips use existing chip styling (`bg-surface text-steel border border-hairline`), never new colors; narration rendered in a distinct but restrained block. No DOM tests (project convention).

- [ ] **Step 1: SceneList — render emotion chip per line + narration block**

In `frontend/src/components/SceneList.tsx`, replace the dialogue `<dl>` block (lines 64-73) and add a narration block before the closing `</div>` of `SceneCardItem`:

```tsx
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
```

- [ ] **Step 2: EditableSceneCard — same read-mode display**

Apply the **identical** dialogue chip + narration blocks from Step 1 to the
read-mode render in `EditableSceneCard.tsx` (replace its dialogue `<dl>` at lines
60-69 and add the narration block after it, before the `{proposal && ...}` block).

- [ ] **Step 3: EditableSceneCard — emotion/intensity selectors + narration editor in the edit form**

In the `EditForm` component, add the imports and constants at the top of the file:

```tsx
import { EMOTIONS, INTENSITIES } from '../../api/pipeline'
```

Replace the per-line dialogue editor (lines 124-140) with one that includes
emotion + intensity selects:

```tsx
        {draft.dialogue.map((d, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-1.5">
              <input className={field + ' w-1/3'} value={d.character} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], character: e.target.value }; set({ dialogue: dl })
              }} placeholder="Character" />
              <input className={field} value={d.line} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], line: e.target.value }; set({ dialogue: dl })
              }} placeholder="Line" />
              <button
                onClick={() => set({ dialogue: draft.dialogue.filter((_, j) => j !== i) })}
                className="text-stone hover:text-brand-error px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded transition-colors"
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1.5 pl-[calc(33%+0.375rem)]">
              <select className={field + ' w-1/2'} value={d.emotion ?? ''} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], emotion: e.target.value || null }; set({ dialogue: dl })
              }}>
                <option value="">emotion…</option>
                {EMOTIONS.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
              <select className={field + ' w-1/2'} value={d.intensity ?? ''} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], intensity: e.target.value || null }; set({ dialogue: dl })
              }}>
                <option value="">intensity…</option>
                {INTENSITIES.map(it => <option key={it} value={it}>{it}</option>)}
              </select>
            </div>
          </div>
        ))}
```

Add a narration editor block after the dialogue `+ Add dialogue line` button
(after line 146), still inside the same `space-y-1.5` div's parent:

```tsx
      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-stone">Narration</div>
        {(draft.narration ?? []).map((n, i) => (
          <div key={i} className="flex gap-1.5">
            <input className={field} value={n} onChange={e => {
              const nr = [...(draft.narration ?? [])]; nr[i] = e.target.value; set({ narration: nr })
            }} placeholder="Narration line" />
            <button
              onClick={() => set({ narration: (draft.narration ?? []).filter((_, j) => j !== i) })}
              className="text-stone hover:text-brand-error px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded transition-colors"
              aria-label="Remove narration line"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => set({ narration: [...(draft.narration ?? []), ''] })}
          className="text-[11px] text-steel hover:text-ink transition-colors"
        >
          + Add narration line
        </button>
      </div>
```

- [ ] **Step 4: Verify build + run the ui-taste smell test**

Run (from `frontend/`): `npm run build`
Expected: build succeeds (no TS errors). Manually confirm: one accent only,
chips reuse token styling, narration block is restrained, focus rings present.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SceneList.tsx frontend/src/components/refine/EditableSceneCard.tsx
git commit -m "feat(parse): emotion chips + narration in scene cards (view + edit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T10: EntityRegistryPanel + parseAliases helper

**Files:**
- Create: `frontend/src/components/refine/entities.ts` (pure helper)
- Create: `frontend/src/components/refine/EntityRegistryPanel.tsx`
- Test: `frontend/src/components/refine/entities.test.ts`

> **UI task — invoke `ui-taste` before the panel JSX.** Card = `rounded-lg border border-hairline bg-canvas`; real loading/empty/error states; one accent.

- [ ] **Step 1: Write the failing helper test**

```typescript
// frontend/src/components/refine/entities.test.ts
import { describe, it, expect } from 'vitest'
import { parseAliases, formatAliases } from './entities'

describe('parseAliases', () => {
  it('splits on commas and newlines, trims, drops blanks + dups', () => {
    expect(parseAliases('đại cản, Dai Can\n đại cản ,, ')).toEqual(['đại cản', 'Dai Can'])
  })
  it('returns empty array for empty input', () => {
    expect(parseAliases('   ')).toEqual([])
  })
})

describe('formatAliases', () => {
  it('joins with comma-space', () => {
    expect(formatAliases(['a', 'b'])).toBe('a, b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm test -- entities`
Expected: FAIL — module missing

- [ ] **Step 3: Write the helper**

```typescript
// frontend/src/components/refine/entities.ts
export function parseAliases(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

export function formatAliases(aliases: string[]): string {
  return aliases.join(', ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npm test -- entities`
Expected: PASS

- [ ] **Step 5: Write the panel component**

```tsx
// frontend/src/components/refine/EntityRegistryPanel.tsx
import { useEffect, useState } from 'react'
import { getEntities, saveEntities, type EntityEntry, type EntityRegistry } from '../../api/pipeline'
import { parseAliases, formatAliases } from './entities'

const ctrl = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'
const field = `w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink ${ctrl}`

interface Props { episodeId: string }

type Kind = 'characters' | 'locations'

export function EntityRegistryPanel({ episodeId }: Props) {
  const [reg, setReg] = useState<EntityRegistry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    getEntities(episodeId)
      .then(r => { if (alive) { setReg(r); setDirty(false) } })
      .catch(e => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [episodeId])

  function edit(kind: Kind, i: number, patch: Partial<EntityEntry>) {
    setReg(r => {
      if (!r) return r
      const list = [...r[kind]]
      list[i] = { ...list[i], ...patch }
      return { ...r, [kind]: list }
    })
    setDirty(true)
  }
  function remove(kind: Kind, i: number) {
    setReg(r => (r ? { ...r, [kind]: r[kind].filter((_, j) => j !== i) } : r))
    setDirty(true)
  }
  async function save() {
    if (!reg) return
    setSaving(true); setError('')
    try {
      const next = await saveEntities(episodeId, { characters: reg.characters, locations: reg.locations })
      setReg(next); setDirty(false)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Names &amp; locations</h3>
        <button onClick={save} disabled={!dirty || saving || !reg}
          className={`px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${ctrl}`}>
          {saving ? 'Saving…' : dirty ? 'Save ●' : 'Saved'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 rounded-md bg-surface animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-brand-error">{error}</p>
      ) : reg && (reg.characters.length === 0 && reg.locations.length === 0) ? (
        <p className="text-xs text-stone">No names learned yet. Parse a chapter to populate this list.</p>
      ) : reg && (
        <div className="space-y-4">
          {(['characters', 'locations'] as Kind[]).map(kind => (
            <div key={kind}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone mb-1.5">{kind}</div>
              <div className="space-y-1.5">
                {reg[kind].map((e, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input className={field + ' w-1/3'} value={e.canonical}
                      onChange={ev => edit(kind, i, { canonical: ev.target.value })} placeholder="Canonical" />
                    <input className={field} value={formatAliases(e.aliases)}
                      onChange={ev => edit(kind, i, { aliases: parseAliases(ev.target.value) })}
                      placeholder="Aliases (comma-separated)" />
                    <button onClick={() => remove(kind, i)} aria-label="Remove entry"
                      className={`text-stone hover:text-brand-error px-1 rounded transition-colors ${ctrl}`}>×</button>
                  </div>
                ))}
                {reg[kind].length === 0 && <p className="text-xs text-stone">None.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/refine/entities.ts frontend/src/components/refine/entities.test.ts frontend/src/components/refine/EntityRegistryPanel.tsx
git commit -m "feat(parse): entity registry panel + alias helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T11: VoiceProfilePanel

**Files:**
- Create: `frontend/src/components/refine/VoiceProfilePanel.tsx`

> **UI task — invoke `ui-taste` first.** Reuse chip styling for emotion counts; one accent; real loading/empty/error states.

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/refine/VoiceProfilePanel.tsx
import { useEffect, useState } from 'react'
import { getVoiceProfiles, type VoiceProfile } from '../../api/pipeline'

interface Props { episodeId: string; refreshKey?: number }

export function VoiceProfilePanel({ episodeId, refreshKey = 0 }: Props) {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    getVoiceProfiles(episodeId)
      .then(r => { if (alive) setProfiles(r.profiles) })
      .catch(e => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [episodeId, refreshKey])

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">Character voices</h3>
      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-surface animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-brand-error">{error}</p>
      ) : profiles.length === 0 ? (
        <p className="text-xs text-stone">No dialogue parsed yet — voice profiles appear once chapters are parsed.</p>
      ) : (
        <ul className="space-y-3">
          {profiles.map(p => (
            <li key={p.character} className="border-t border-hairline pt-2.5 first:border-t-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-ink">{p.character}</span>
                <span className="text-[10px] text-stone">
                  {p.line_count} line{p.line_count === 1 ? '' : 's'}
                  {p.dominant_emotion ? ` · mostly ${p.dominant_emotion}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(p.emotions).sort((a, b) => b[1] - a[1]).map(([em, n]) => (
                  <span key={em} className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[10px] bg-surface text-steel border border-hairline">
                    {em} · {n}
                  </span>
                ))}
                {Object.keys(p.emotions).length === 0 && (
                  <span className="text-[10px] text-stone">no emotion tags</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/refine/VoiceProfilePanel.tsx
git commit -m "feat(parse): derived character voice-profile panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T12: Wire panels into ChapterView

**Files:**
- Modify: `frontend/src/studio/views/ChapterView.tsx`

> **UI task — invoke `ui-taste` first.** Panels go in a clearly-labeled, full-width "Episode insights" section below the chapter grid (entities + voice profiles are episode-scoped, not chunk-scoped). Two-column on `lg`.

- [ ] **Step 1: Import the panels**

Add to the imports block (after the `EditableSceneCard` import, ~line 17):

```tsx
import { EntityRegistryPanel } from '../../components/refine/EntityRegistryPanel'
import { VoiceProfilePanel } from '../../components/refine/VoiceProfilePanel'
```

- [ ] **Step 2: Add a refresh key so voice profiles refetch after a parse**

Add state near the other page state (after `const [skipped, setSkipped] = useState(0)`, ~line 57):

```tsx
  const [profilesRefresh, setProfilesRefresh] = useState(0)
```

In `onParse`, bump it where the parse completes — inside the `if (event.type === 'complete')` branch, after `loadScenes()`:

```tsx
            setProposals({}); loadScenes(); setProfilesRefresh(k => k + 1)
```

- [ ] **Step 3: Render the section below the main grid**

Insert before the final closing `</div>` of the component's return (after the
closing `</div>` of the `grid` container, ~line 388):

```tsx
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink mb-1">Episode insights</h2>
        <p className="text-xs text-stone mb-3">Names &amp; voices span the whole episode, not just this chapter.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <EntityRegistryPanel episodeId={episodeId} />
          <VoiceProfilePanel episodeId={episodeId} refreshKey={profilesRefresh} />
        </div>
      </section>
```

- [ ] **Step 4: Verify build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/studio/views/ChapterView.tsx
git commit -m "feat(parse): wire entity + voice-profile panels into ChapterView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B-T13: ui-taste pass + full verification

**Files:** review-only across all changed frontend files.

- [ ] **Step 1: Invoke the `ui-taste` skill** and run its smell test against
  `SceneList.tsx`, `EditableSceneCard.tsx`, `EntityRegistryPanel.tsx`,
  `VoiceProfilePanel.tsx`, and the new ChapterView section. Confirm: one accent
  (`#3772cf`), token-only color/spacing/radius (no arbitrary `[..px]` except the
  intentional `pl-[calc(...)]` alignment in the dialogue editor, which is
  layout not color), real loading/empty/error states, restrained motion
  (`animate-pulse` skeletons only), focus-visible rings on every control, no
  emoji-as-placeholder. Fix any violations inline.

- [ ] **Step 2: Run the full frontend test suite + build**

Run (from `frontend/`): `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 3: Run the full backend suite**

Run: `python -m pytest tests/ -q`
Expected: all pass.

- [ ] **Step 4: Commit any ui-taste fixes**

```bash
git add -A
git commit -m "polish(parse): ui-taste pass on enrichment panels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 model changes → B-T4 (backend), B-T8 (frontend).
- §3 entity registry module → B-T1/T2/T3.
- §4 correction flow → enabled by B-T2 (normalize) + B-T6 (PUT) + B-T5 (re-parse consults registry); exercised end-to-end in B-T5 test.
- §5 parse flow → B-T5.
- §6 voice profiles → B-T7 (backend), B-T11 (frontend).
- §7 routes → B-T6 (entities), B-T7 (voice-profiles).
- §8 frontend → B-T8 (api), B-T9 (cards), B-T10 (entity panel), B-T11 (voice panel), B-T12 (wiring).
- §9 testing → tests embedded in every backend task + B-T8/T10 frontend; B-T13 full-suite gate.
- §10 out-of-scope honored (no apply-without-reparse, no global registry, no LLM voice descriptor, narration is `list[str]`).

**Type consistency:** `EntityEntry {canonical, aliases}` matches backend `AliasEntry`; `VoiceProfile` fields match `voice_profiles.aggregate` output keys; `EntityRegistry` matches `to_dict()`; `narration?: string[]` optional on read (old JSON) while backend `SceneModel.narration` defaults `[]` on write. Registry I/O signature `load(episode_id, episode_dir)` / `save(registry, episode_dir, *, now)` is used identically in B-T1, B-T5, B-T6, B-T7.

**Placeholder scan:** none — every code/test step contains full content.
