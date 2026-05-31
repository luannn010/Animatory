# MVP Tradeoffs & Improvement Notes

Decisions made for fastest dev time, with notes on what to upgrade later.

---

## 1. Run store: SQLite per-connection (no connection pool)

**What we did:** Each async DB call opens+closes its own `aiosqlite.connect()`. Simple, zero setup.

**Why it's fine for MVP:** Single-server, low concurrency.

**Upgrade path:** Switch to a shared persistent connection, or replace with PostgreSQL + asyncpg for production. Consider SQLAlchemy async + Alembic for migrations.

---

## 2. Background task via `asyncio.create_task` (no queue)

**What we did:** Agent runs as an `asyncio.create_task` inside the server process. No worker queue, no persistence of in-flight jobs.

**Why it's fine for MVP:** Simplest path to non-blocking POST /run. Works for short-lived agents.

**Upgrade path:** Use Celery + Redis, Temporal, or a simple pg-backed task queue. Enables: retries across restarts, distributed workers, job cancellation.

---

## 3. Precondition & acceptance checks are stubs (always True)

**What we did:** `_check_precondition()` and `_check_acceptance()` return `True` unconditionally. The YAML rules are stored but not evaluated.

**Why it's fine for MVP:** Gate logic requires domain-specific evaluators (e.g. "all 3 tracks reported done" needs pipeline state). Stub lets the lifecycle run end-to-end.

**Upgrade path:** Implement a rule engine (simple Python eval on context keys, or a DSL). Register evaluators per rule string pattern.

---

## 4. ComfyUI node injection uses title-based matching only

**What we did:** Context is injected into nodes whose `_meta.title` starts with `"Animatory:"`. No explicit mapping file.

**Why it's fine for MVP:** Explicit, readable, no magic. Works for the sample workflows.

**Upgrade path:** Add a per-agent `node_injection_map` config in `agent-framework.yaml` (node_id -> context_key), so injection is driven by data not title conventions. Avoids fragility if workflow editor renames nodes.

---

## 5. InMemoryRunStore for tests uses a shared in-memory SQLite connection

**What we did:** `InMemoryRunStore` holds one `aiosqlite.Connection` open. Simpler than per-call connects for the `:memory:` case.

**Upgrade path:** Replace both stores with a proper async session factory. Or swap for a full in-memory Redis mock in tests.

---

## 6. SSE stream polls the DB every 0.5s

**What we did:** The `/runs/{run_id}/stream` generator polls `store.get()` at 500ms intervals.

**Upgrade path:** Replace with an `asyncio.Queue` or `anyio` memory channel per run_id. Agent pushes events; SSE generator reads them. Eliminates DB polling and reduces latency to milliseconds.

---

## 7. No authentication / CORS

**What we did:** FastAPI serves all routes unauthenticated with no CORS config.

**Upgrade path:** Add `CORSMiddleware` for the frontend origin immediately. Add API key or JWT auth before any network exposure.

---

## 8. llama.cpp executor assumes OpenAI-compatible `/v1/chat/completions`

**What we did:** Works against llama.cpp's `llama-server` with `--chat-template` flag, or any OpenAI-compatible endpoint (Ollama, LM Studio, etc.).

**Upgrade path:** Add a native Anthropic SDK path (Claude API) as an alternative executor for cloud reasoning agents. The `model_suggested` field in the YAML is the right place to wire this.

---

## 9. No orchestration beyond single-agent runs

**What we did:** Each POST /run fires one agent. The `orch.showrunner` spawns field in YAML is recorded but not acted on.

**Upgrade path:** Implement a `SequentialOrchestrator` that reads `spawns` + `gates` from the showrunner definition, runs children in declared order, passes outputs as context to downstream agents. Then replace with LangGraph or Temporal for parallel tracks.

---

## 10. `agent-framework.yaml` fields `name` and `emits_metrics` are optional at parse time

**What we did:** `AgentDef.name` defaults to `""` so agents without an explicit `name:` field still load. This matches the current YAML which omits `name` on most agents.

**Upgrade path:** Make `name` required in the YAML and add a pre-load linter that validates required fields are present before the server starts.

---

## Quick wins (under 2 hours each)

- [ ] Add `CORS_ORIGINS` env var + `CORSMiddleware` (30 min)
- [ ] Add a `GET /runs` list endpoint with pagination (45 min)  
- [ ] Emit a structured JSON log line per run completion (30 min)
- [ ] Add `--host` / `--port` flags to CLI (15 min)
- [ ] Write a `conftest.py` that patches `ANIMATORY_YAML_PATH` to point at the test fixtures dir (20 min)

---

# Frontend MVP Tradeoffs & Improvements

---

## F1. Tailwind arbitrary values not in config

**What we did:** Stack accent colors like `bg-[#E0A800]/15` used as arbitrary values in JSX for speed.

**Upgrade path:** Register all stack accent colors as named tokens in `tailwind.config.js` and use `bg-stack-orch/15` etc. Avoids JIT purge edge cases.

---

## F2. RunsHistory reads mock store directly (no `GET /runs` endpoint)

**What we did:** In mock mode, `RunsHistory` reads `MOCK_RUNS` array directly. In live mode the table is empty because `GET /runs` is not in the spec.

**Upgrade path:** Backend adds `GET /runs?limit=25&cursor=...`, frontend adds `api.listRuns()` call. Short-term: store triggered run IDs in `localStorage`.

---

## F3. MetricsView computed client-side only

**What we did:** Metrics aggregated from `MOCK_RUNS` in the browser. No live metrics endpoint.

**Upgrade path:** Backend adds `GET /metrics` returning `MetricsSnapshot`. Frontend calls it; keeps client-side as fallback.

---

## F4. No error boundary

**What we did:** Unhandled render errors crash the full page.

**Upgrade path:** Wrap router views in a React `ErrorBoundary` component with a "Something went wrong" fallback that preserves the nav.

---

## F5. SSE mock — no reconnect on disconnect

**What we did:** Mock SSE is a `setTimeout` chain; live `EventSource` has no reconnect logic.

**Upgrade path:** Add `onerror` handler that retries with exponential backoff (3 attempts) then shows a "Connection lost — retry" banner.

---

## F6. No input validation in RunTriggerPanel

**What we did:** Required fields labeled but not enforced — form submits with empty required inputs.

**Upgrade path:** Validate required inputs before `api.triggerRun()`. Show per-field `text-[#d45656]` error messages.

---

## F7. No test coverage

**What we did:** Zero tests for MVP speed.

**Priority additions (Vitest + React Testing Library):**
1. `mock.ts` — verify `streamRun` emits correct event sequence
2. `RunTriggerPanel` — form submit calls `api.triggerRun` with correct payload
3. `AgentsView` — stack grouping renders correct sections
4. `StatusBadge` — snapshot all 5 statuses

---

## F8. Accessibility gaps

- "Run" button in `AgentCard`: add `aria-label={`Trigger run for ${agent.name}`}`
- Close button in `RunTriggerPanel`: add `aria-label="Close"`
- Log panel: add `role="log" aria-live="polite"` for screen reader announcements
- Status dot: `aria-hidden="true"` on decorative span

---

## Frontend + Backend integration checklist

When switching to `VITE_USE_MOCK=false`:

- [ ] Backend running at `VITE_API_BASE_URL` (default `http://localhost:8000`)
- [ ] `GET /health` returns `{"ok": true}` (or `{"status": "ok"}` — frontend checks `.ok` field)
- [ ] CORS: backend allows origin `http://localhost:5173`
- [ ] `GET /agents` returns array of objects matching `AgentSchema` (all fields present)
- [ ] `POST /agents/{id}/run` accepts `{"context": {}, "system_prompt": ""}`, returns `{"run_id": "..."}`
- [ ] `GET /runs/{run_id}` returns full `RunRecord` (all fields including `logs`, `outputs`)
- [ ] `GET /runs/{run_id}/stream` streams `text/event-stream` with `data: <json>\n\n` lines
- [ ] SSE events are JSON-encoded `RunEvent` objects (match `src/types.ts` shape)
- [ ] Artifact `url` fields in outputs are absolute URLs or backend-proxied paths
- [ ] Add `GET /runs` route for `RunsHistory` table to work in live mode
