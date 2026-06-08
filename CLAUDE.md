# Animatory — CLAUDE.md

## Design Authority & UI Taste (read before any UI work)

**The design specs are the source of truth.** Before building or changing any
studio UI, read the relevant spec in `docs/superpowers/specs/` and follow it.
The studio surface is governed by
[`2026-06-02-studio-ui-design.md`](docs/superpowers/specs/2026-06-02-studio-ui-design.md);
the transcript/parse pipeline by
[`2026-06-02-transcript-pipeline-design.md`](docs/superpowers/specs/2026-06-02-transcript-pipeline-design.md).
A spec defines *what* and *why* — do not silently deviate from layout, routes,
data shapes, or flows it specifies. If a change requires departing from a spec,
update the spec in the same change and say so.

**Taste is mandatory, not optional.** Whenever you build, modify, or review
frontend UI, invoke the **`ui-taste`** skill first. It encodes the concrete
anti-AI-slop rules for this codebase (one accent color, token-only values, real
loading/empty/error states, restrained motion, emoji-as-placeholder, etc.).
"It compiles and renders" is not the bar — it must look *designed*. Run the
skill's smell test before calling any UI task done.

## Frontend MVP

### Project Purpose
A thin-client SPA to register/inspect agents in the 2D animation pipeline,
trigger runs, watch live SSE status/log streams, and review run history + metrics.
No generation logic lives here — it is a display layer over a backend HTTP API.

### Frontend API Contract (fixed — do not invent new routes)

| Method | Route                        | Body / Response                              |
|--------|------------------------------|----------------------------------------------|
| GET    | /agents                      | AgentSchema[]                                |
| POST   | /agents/{agent_id}/run       | {context, system_prompt} → {run_id: string}  |
| GET    | /runs/{run_id}               | RunRecord                                    |
| GET    | /runs/{run_id}/stream        | SSE stream of RunEvent                       |
| GET    | /health                      | {ok: boolean}                                |

### Frontend Run-Record Shape

```ts
interface RunRecord {
  run_id: string;
  agent_id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'retrying';
  attempts: number;
  duration_s: number | null;
  cost: number | null;
  gpu_seconds: number | null;
  acceptance_passed: boolean | null;
  outputs: OutputArtifact[];
  error: string | null;
  created_at: string;
  logs: string[];
}
```

### Frontend Tech Stack
- React 18 + Vite 5 + TypeScript 5
- React Router 6 (SPA routing)
- Tailwind CSS 3 (Animatory design tokens in `tailwind.config.ts`)
- Fonts: Inter (UI prose), Geist Mono (logs, IDs, code)

### How to Run Frontend

```bash
cd frontend
npm install
cp .env.example .env      # VITE_USE_MOCK=true by default
npm run dev               # http://localhost:5173
npm run build
```

### Frontend Conventions
- **Follow the design spec + run the `ui-taste` skill** (see "Design Authority & UI Taste" above) for any UI change
- All API calls via `src/api/index.ts` (agents) or `src/studio/api.ts` (studio) — never `fetch()` in components
- Set `VITE_USE_MOCK=true` for zero-backend operation (mock fixtures); studio has its own `VITE_STUDIO_USE_MOCK` (default mock)
- One accent only: studio `#3772cf`; status colors are semantic, never decorative
- Spacing/radius/color come from `tailwind.config.js` tokens — no arbitrary `[..px]` or hex literals
- Pill buttons: `rounded-full`; cards: `rounded-lg border border-hairline bg-canvas`; controls: `rounded-md`
- Header: dark teal gradient `linear-gradient(135deg, #1a3d4a 0%, #2d5a4f 100%)` (the one allowed gradient outside thumbnails)

---

## Streaming Spell-Check (invariants — do not break)

See `docs/superpowers/specs/2026-06-08-streaming-spellcheck-design.md`.

- **Segment model:** the editor buffer is split into 5–7 boundary-safe
  *segments* (paragraph boundaries, sentence fallback; default target 650
  words/segment). Concatenating segment texts in order reproduces the document
  byte-for-byte; each segment carries a `char_offset` (its start index in the
  full document). Code: `animatory/spellcheck/chunker.py`.
- **Finding schema (WS wire shape):**
  `{ type: 'spelling'|'grammar'|'naming', original, suggestion, char_start,
  char_end, reason }`. `char_*` are GLOBAL offsets into the full document;
  `char_end` is exclusive (`text.slice(char_start, char_end) === original`).
- **Global-offset rule:** applying a finding shifts every later unapplied
  finding by `delta = suggestion.length - (char_end - char_start)`; "Accept all"
  applies back-to-front; always verify `slice === original` (relocate or mark
  stale on mismatch); overlapping findings keep the first in document order.
  This logic lives in `frontend/src/spellcheck/offsets.ts` and is unit-tested.
- **WS contract:** `ws .../pipeline/episodes/{ep}/chunks/{chunk}/spellcheck/ws`.
  Client sends `{action:'start', document}`. Server streams `chunk_started`,
  `chunk_findings` (global offsets, per segment), `naming_findings` (after all
  segments), `complete`, and per-segment `error` (one bad segment never aborts
  the stream). This route is additive — do not change existing contract routes.

---

## Backend MVP

### Project Purpose

A FastAPI Python backend that loads agent definitions from `agent-framework.yaml`, runs "base agents" through a shared lifecycle (`validate → preconditions → execute → acceptance → emit run-record`), and exposes them over HTTP.

The two executor implementations in the MVP are:

1. **ComfyUI adaptor** — POSTs workflow JSON to the ComfyUI `/prompt` API, polls for completion, collects artifacts
2. **llama.cpp text executor** — calls a local `llama-server` OpenAI-compatible endpoint for reasoning agents

---

## Base Agent Contract (from agent-framework.yaml)

```yaml
base_agent:
  id: string                          # e.g. exec.animation
  name: string                        # human-readable label
  layer:
    enum: [orchestration, execution, audit]
  stack:
    enum: [orchestration, comfyui, text, audio, image, video, utility]
  role: string
  responsibility: string
  status:
    enum: [idle, running, retrying, done, failed]
  inputs:
    - name: string
      type: string
      required: bool
  outputs:
    - name: string
      type: string
      path: string
  trigger:
    enum: [called_by_orchestrator, event, manual]
  idempotent: bool
  retry:
    max_attempts: int
    backoff:
      enum: [none, linear, exponential]
  timeout_s: int
  preconditions: [string]
  acceptance: [string]
  on_fail:
    enum: [retry, escalate, skip, halt]
  emits_metrics: [string]
  cost_estimate: string
```

---

## HTTP API Contract

The frontend depends on these **exact** route signatures — do not change them.

| Method | Route | Request | Response |
|--------|-------|---------|----------|
| POST | `/agents/{agent_id}/run` | `{context: object, system_prompt: string}` | `{run_id: string}` |
| GET | `/agents` | — | `[{id, name, layer, stack, role, inputs, outputs}]` |
| GET | `/runs/{run_id}` | — | full run-record |
| GET | `/runs/{run_id}/stream` | — | SSE `text/event-stream` |
| GET | `/health` | — | `{status: "ok", agents_loaded: int}` |

---

## Run-Record Shape

```json
{
  "run_id": "string",
  "agent_id": "string",
  "status": "queued|running|retrying|done|failed",
  "attempts": 1,
  "started_at": "2026-05-31T00:00:00Z",
  "finished_at": "2026-05-31T00:00:05Z",
  "duration_s": 5.0,
  "cost": 0.002,
  "gpu_seconds": 12.4,
  "tokens": 512,
  "acceptance_passed": true,
  "outputs": [{"name": "string", "type": "string", "path": "string", "artifact_url": "string"}],
  "error": null,
  "logs": ["string"]
}
```

---

## Audit Metrics Emitted Per Run

From `agent-framework.yaml` audit_layer:

- **run**: agent_id, run_id, status, attempts, duration_s, cost, tokens, gpu_seconds
- **quality**: acceptance_passed, retake_count, consistency_score, manual_overrides
- **pipeline**: episode_id, phase, track, blocked_on, critical_path

---

## Tech Stack

- **Python 3.11+**
- **FastAPI** + **uvicorn** — HTTP server
- **Pydantic v2** — all models and YAML schema validation
- **PyYAML** — loading `agent-framework.yaml`
- **httpx** — async HTTP (ComfyUI + llama.cpp)
- **asyncio** — concurrency and SSE streaming
- **aiosqlite** — SQLite run-record persistence (`:memory:` for in-memory mode)
- **sse-starlette** — SSE support
- **pytest** + **pytest-asyncio** — test suite

---

## How to Run Locally

```bash
# Install
pip install -e ".[dev]"

# Start server (loads agents from agent-framework.yaml)
uvicorn animatory.server:app --reload --port 8000

# With fake executors (no GPU/llama.cpp needed)
ANIMATORY_FAKE_EXECUTORS=1 uvicorn animatory.server:app --reload --port 8000

# Run one ComfyUI agent against fixtures
python -m animatory.cli run exec.animation --context fixtures/animation_context.json --fake

# Run one text agent (showrunner) against fixtures
python -m animatory.cli run orch.showrunner --context fixtures/showrunner_context.json --fake

# List all registered agents
python -m animatory.cli list

# Run tests (no GPU required)
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -v
```

---

## Project Layout

```
animatory/
  __init__.py
  server.py          # FastAPI app + all routes
  registry.py        # loads agent-framework.yaml -> AgentRegistry
  models.py          # Pydantic models: AgentDef, RunRecord, RunRequest, etc.
  base_agent.py      # BaseAgent — shared lifecycle (validate/run/accept/emit)
  run_store.py       # SQLite run-record store (also InMemoryRunStore for tests)
  cli.py             # argparse CLI
  executors/
    __init__.py
    base.py          # AbstractExecutor interface
    comfyui.py       # ComfyUI adaptor
    llamacpp.py      # llama.cpp / llama-server adaptor
    fake.py          # FakeExecutor — canned artifacts, no GPU needed
  agents/
    __init__.py      # placeholder for future custom agent subclasses
agent-framework.yaml
workflows/
  anim_block.json
  anim_inbetween.json
  anim_lipsync.json
  rig_build.json
fixtures/
  animation_context.json
  showrunner_context.json
tests/
  test_registry.py
  test_base_agent.py
  test_api.py
```

---

## Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `ANIMATORY_YAML_PATH` | `agent-framework.yaml` | Path to agent definitions |
| `ANIMATORY_FAKE_EXECUTORS` | `0` | Set to `1` to use FakeExecutor for all agents |
| `COMFYUI_ENDPOINT` | `http://localhost:8188` | ComfyUI API base URL |
| `COMFYUI_POLL_INTERVAL_S` | `2` | Poll interval in seconds |
| `LLAMACPP_ENDPOINT` | `http://localhost:8080` | llama-server base URL |
| `LLAMACPP_MODEL` | `local` | Model name to pass in requests |
| `LLAMACPP_CONTEXT_LENGTH` | `4096` | Context window size |
| `DB_PATH` | `animatory.db` | SQLite path; `:memory:` for in-memory |

---

## How to Add a New Agent

1. Add an entry to `agent-framework.yaml` under the correct layer/stack section
2. If using an existing stack (`comfyui`/`text`/`audio`), no new executor code needed
3. If adding a new executor, implement `AbstractExecutor` in `animatory/executors/`
4. Drop workflow JSON files in `workflows/` if ComfyUI-based
5. Restart the server

---

## Coding Conventions

- All models are **Pydantic v2** `BaseModel` with strict typing
- **Async throughout** — no sync blocking in request path
- Executors return `ExecutorResult`; agents never reimplement lifecycle
- **Fail loudly at startup**: YAML schema errors raise `ValueError`, not at runtime
- Every log record includes `agent_id` and `run_id`

---

## Definition of Done (MVP)

- [ ] `agent-framework.yaml` loads; all agent defs validate
- [ ] `POST /agents/exec.animation/run` returns `run_id`, run completes
- [ ] `POST /agents/orch.showrunner/run` returns `run_id`, structured output
- [ ] `GET /runs/{run_id}` returns complete run-record with audit metrics
- [ ] `GET /runs/{run_id}/stream` delivers SSE events during run
- [ ] `on_fail=escalate` raises HTTPException 500
- [ ] `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/` passes
