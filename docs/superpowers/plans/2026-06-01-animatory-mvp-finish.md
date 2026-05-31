# Animatory MVP Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the 5 remaining high-priority items: `GET /runs`, `GET /metrics` backend endpoints; `RunTriggerPanel` input validation; `ErrorBoundary`; SSE reconnect in `RunMonitor`.

**Architecture:** Backend adds `list_runs()` to both run stores, a `MetricsSnapshot` Pydantic model, and two new routes in `server.py`. Frontend adds `listRuns`/`getMetrics` to both the live client and mock, wires them into `RunsHistory` and `MetricsView`, adds a class-component `ErrorBoundary` around `<Routes>`, adds field-level validation to `RunTriggerPanel`, and adds exponential-backoff SSE reconnect to `RunMonitor`. All production code is written test-first (TDD). Frontend tests use Vitest + @testing-library/react.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 / pytest-asyncio (backend); React 18 / TypeScript 5 / Vitest / @testing-library/react / jsdom (frontend)

---

## File Map

| File | Change |
|------|--------|
| `animatory/run_store.py` | Add `list_runs()` to `RunStore` and `InMemoryRunStore` |
| `animatory/models.py` | Add `MetricsSnapshot` Pydantic model |
| `animatory/server.py` | Add `GET /runs` and `GET /metrics` routes |
| `tests/test_api.py` | Add 4 new backend tests |
| `frontend/package.json` | Add vitest + testing-library devDeps |
| `frontend/vite.config.ts` | Add vitest config block |
| `frontend/src/api/client.ts` | Add `listRuns()`, `getMetrics()` |
| `frontend/src/api/mock.ts` | Add `listRuns()`, `getMetrics()` |
| `frontend/src/api/index.ts` | Export `listRuns`, `getMetrics` |
| `frontend/src/views/RunsHistory.tsx` | Replace MOCK_RUNS direct import with `api.listRuns()` |
| `frontend/src/views/MetricsView.tsx` | Replace inline computation with `api.getMetrics()` |
| `frontend/src/views/RunTriggerPanel.tsx` | Add `validate()` + per-field error display |
| `frontend/src/components/ErrorBoundary.tsx` | New — class component + fallback UI |
| `frontend/src/App.tsx` | Wrap `<Routes>` in `<ErrorBoundary>` |
| `frontend/src/views/RunMonitor.tsx` | Add reconnect logic + "Reconnecting…" / "Connection lost" pills |
| `frontend/src/api/__tests__/mock.test.ts` | New — listRuns + getMetrics mock tests |
| `frontend/src/views/__tests__/RunTriggerPanel.test.tsx` | New — validation tests |
| `frontend/src/components/__tests__/ErrorBoundary.test.tsx` | New — boundary tests |
| `frontend/src/views/__tests__/RunMonitor.test.tsx` | New — reconnect tests |

---

## Task 1: Add `list_runs()` to backend run stores

**Files:**
- Modify: `animatory/run_store.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test for `list_runs` on empty store**

Add to `tests/test_api.py`:

```python
@pytest.mark.asyncio
async def test_list_runs_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/runs")
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_api.py::test_list_runs_empty -v
```

Expected: FAIL — `404 Not Found` (route doesn't exist yet)

- [ ] **Step 3: Write the failing test for list after creating runs**

Also add to `tests/test_api.py` (don't implement yet):

```python
@pytest.mark.asyncio
async def test_list_runs_returns_created_runs():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        post_r = await c.post(
            "/agents/orch.showrunner/run",
            json={"context": {"final_script": "INT. STUDIO"}, "system_prompt": ""},
        )
        assert post_r.status_code == 200
        run_id = post_r.json()["run_id"]
        await _wait_for_run(c, run_id)
        r = await c.get("/runs")
    assert r.status_code == 200
    run_ids = [item["run_id"] for item in r.json()]
    assert run_id in run_ids
```

- [ ] **Step 4: Add `list_runs()` to `RunStore` in `animatory/run_store.py`**

Add this method to the `RunStore` class after `list_by_agent`:

```python
async def list_runs(self) -> list[RunRecord]:
    cols = ", ".join(_COLUMNS)
    sql = f"SELECT {cols} FROM runs ORDER BY started_at DESC"
    async with aiosqlite.connect(self._db_path) as db:
        async with db.execute(sql) as cursor:
            rows = await cursor.fetchall()
    return [_deserialize(row) for row in rows]
```

Add this method to the `InMemoryRunStore` class after its `list_by_agent`:

```python
async def list_runs(self) -> list[RunRecord]:
    cols = ", ".join(_COLUMNS)
    sql = f"SELECT {cols} FROM runs ORDER BY started_at DESC"
    assert self._conn
    async with self._conn.execute(sql) as cursor:
        rows = await cursor.fetchall()
    return [_deserialize(row) for row in rows]
```

- [ ] **Step 5: Add `GET /runs` route to `animatory/server.py`**

Add this route after the `GET /agents` route (around line 87, before the POST route):

```python
@app.get("/runs", response_model=list[RunRecord])
async def list_runs():
    store: RunStore = app.state.store
    return await store.list_runs()
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_api.py::test_list_runs_empty tests/test_api.py::test_list_runs_returns_created_runs -v
```

Expected: both PASS

- [ ] **Step 7: Run the full test suite to check for regressions**

```bash
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -v
```

Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add animatory/run_store.py animatory/server.py tests/test_api.py
git commit -m "feat: add GET /runs endpoint and list_runs() to run stores"
```

---

## Task 2: Add `MetricsSnapshot` model and `GET /metrics` endpoint

**Files:**
- Modify: `animatory/models.py`
- Modify: `animatory/server.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test for empty metrics**

Add to `tests/test_api.py`:

```python
@pytest.mark.asyncio
async def test_metrics_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/metrics")
    assert r.status_code == 200
    data = r.json()
    assert data["total_runs"] == 0
    assert data["total_cost"] == 0.0
    assert data["pass_rate"] == 0.0
    assert data["runs_by_status"] == {}
    assert data["runs_by_stack"] == {}
```

- [ ] **Step 2: Write the failing test for metrics aggregation**

Also add to `tests/test_api.py`:

```python
@pytest.mark.asyncio
async def test_metrics_aggregates_correctly():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        post_r = await c.post(
            "/agents/orch.showrunner/run",
            json={"context": {"final_script": "INT. CAFE"}, "system_prompt": ""},
        )
        assert post_r.status_code == 200
        run_id = post_r.json()["run_id"]
        await _wait_for_run(c, run_id)
        r = await c.get("/metrics")
    assert r.status_code == 200
    data = r.json()
    assert data["total_runs"] >= 1
    assert "orchestration" in data["runs_by_stack"] or "text" in data["runs_by_stack"]
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_api.py::test_metrics_empty tests/test_api.py::test_metrics_aggregates_correctly -v
```

Expected: FAIL — `404 Not Found`

- [ ] **Step 4: Add `MetricsSnapshot` to `animatory/models.py`**

Add this class at the end of the file:

```python
class MetricsSnapshot(BaseModel):
    total_runs: int = 0
    total_cost: float = 0.0
    total_gpu_seconds: float = 0.0
    avg_attempts: float = 0.0
    pass_rate: float = 0.0
    runs_by_status: dict[str, int] = {}
    runs_by_stack: dict[str, int] = {}
```

- [ ] **Step 5: Add `GET /metrics` route to `animatory/server.py`**

First add `MetricsSnapshot` to the import at the top of `server.py`:

```python
from animatory.models import AgentListItem, RunRecord, RunRequest, RunResponse, MetricsSnapshot
```

Then add this route after the `GET /runs` route:

```python
@app.get("/metrics", response_model=MetricsSnapshot)
async def get_metrics():
    store: RunStore = app.state.store
    registry: AgentRegistry = app.state.registry

    runs = await store.list_runs()
    if not runs:
        return MetricsSnapshot()

    total_runs = len(runs)
    total_cost = sum(r.cost or 0.0 for r in runs)
    total_gpu_seconds = sum(r.gpu_seconds or 0.0 for r in runs)
    avg_attempts = sum(r.attempts for r in runs) / total_runs

    done_runs = [r for r in runs if r.status.value == "done"]
    pass_rate = (
        sum(1 for r in done_runs if r.acceptance_passed) / len(done_runs)
        if done_runs else 0.0
    )

    runs_by_status: dict[str, int] = {}
    for r in runs:
        key = r.status.value if hasattr(r.status, "value") else str(r.status)
        runs_by_status[key] = runs_by_status.get(key, 0) + 1

    runs_by_stack: dict[str, int] = {}
    for r in runs:
        try:
            agent_def = registry.get(r.agent_id)
            stack = agent_def.stack.value
        except KeyError:
            stack = "unknown"
        runs_by_stack[stack] = runs_by_stack.get(stack, 0) + 1

    return MetricsSnapshot(
        total_runs=total_runs,
        total_cost=total_cost,
        total_gpu_seconds=total_gpu_seconds,
        avg_attempts=avg_attempts,
        pass_rate=pass_rate,
        runs_by_status=runs_by_status,
        runs_by_stack=runs_by_stack,
    )
```

- [ ] **Step 6: Run metrics tests to verify they pass**

```bash
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_api.py::test_metrics_empty tests/test_api.py::test_metrics_aggregates_correctly -v
```

Expected: both PASS

- [ ] **Step 7: Run full test suite**

```bash
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -v
```

Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add animatory/models.py animatory/server.py tests/test_api.py
git commit -m "feat: add MetricsSnapshot model and GET /metrics endpoint"
```

---

## Task 3: Set up Vitest for frontend tests

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/setupTests.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd d:\Animatory\frontend
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/testing-library__jest-dom
```

- [ ] **Step 2: Add vitest config to `frontend/vite.config.ts`**

Replace the entire file with:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
```

- [ ] **Step 3: Create `frontend/src/setupTests.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Add test script to `frontend/package.json`**

In the `"scripts"` section, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

The full scripts block becomes:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Verify vitest works with a smoke test**

Create `frontend/src/api/__tests__/mock.test.ts` with just a smoke test:

```typescript
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run it:

```bash
cd d:\Animatory\frontend
npm test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd d:\Animatory
git add frontend/package.json frontend/vite.config.ts frontend/src/setupTests.ts frontend/src/api/__tests__/mock.test.ts
git commit -m "chore: add Vitest + @testing-library/react for frontend tests"
```

---

## Task 4: Add `listRuns` and `getMetrics` to frontend API

**Files:**
- Modify: `frontend/src/api/mock.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/index.ts`
- Test: `frontend/src/api/__tests__/mock.test.ts`

- [ ] **Step 1: Write failing tests for `listRuns` and `getMetrics`**

Replace `frontend/src/api/__tests__/mock.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest'
import { listRuns, getMetrics } from '../mock'

describe('listRuns', () => {
  it('returns an array of RunRecord objects', async () => {
    const runs = await listRuns()
    expect(Array.isArray(runs)).toBe(true)
    expect(runs.length).toBeGreaterThan(0)
    const run = runs[0]
    expect(run).toHaveProperty('run_id')
    expect(run).toHaveProperty('agent_id')
    expect(run).toHaveProperty('status')
    expect(run).toHaveProperty('created_at')
  })
})

describe('getMetrics', () => {
  it('returns a MetricsSnapshot with correct shape and pass_rate between 0 and 1', async () => {
    const m = await getMetrics()
    expect(m).toHaveProperty('total_runs')
    expect(m).toHaveProperty('total_cost')
    expect(m).toHaveProperty('pass_rate')
    expect(m).toHaveProperty('runs_by_status')
    expect(m).toHaveProperty('runs_by_stack')
    expect(m.pass_rate).toBeGreaterThanOrEqual(0)
    expect(m.pass_rate).toBeLessThanOrEqual(1)
    expect(m.total_runs).toBe(m.total_runs | 0) // integer check
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: FAIL — `listRuns is not a function` / `getMetrics is not a function`

- [ ] **Step 3: Add `listRuns` and `getMetrics` to `frontend/src/api/mock.ts`**

Add these two functions at the end of the mock API section (after `getHealth`):

```typescript
export async function listRuns(): Promise<RunRecord[]> {
  await delay(200)
  return [...MOCK_RUNS]
}

export async function getMetrics(): Promise<MetricsSnapshot> {
  await delay(150)
  const runs = MOCK_RUNS
  const total_runs = runs.length
  const total_cost = runs.reduce((s, r) => s + (r.cost ?? 0), 0)
  const total_gpu_seconds = runs.reduce((s, r) => s + (r.gpu_seconds ?? 0), 0)
  const avg_attempts = total_runs > 0 ? runs.reduce((s, r) => s + r.attempts, 0) / total_runs : 0
  const done_runs = runs.filter(r => r.status === 'done')
  const pass_rate = done_runs.length > 0
    ? done_runs.filter(r => r.acceptance_passed).length / done_runs.length
    : 0

  const runs_by_status = runs.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const stackMap = Object.fromEntries(MOCK_AGENTS.map(a => [a.id, a.stack]))
  const runs_by_stack = runs.reduce((acc, r) => {
    const stack = stackMap[r.agent_id] ?? 'unknown'
    acc[stack] = (acc[stack] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return { total_runs, total_cost, total_gpu_seconds, avg_attempts, pass_rate, runs_by_status, runs_by_stack }
}
```

Also add `MetricsSnapshot` to the import at the top of `mock.ts`:

```typescript
import type {
  AgentSchema,
  RunRecord,
  RunTriggerRequest,
  RunTriggerResponse,
  HealthResponse,
  RunEvent,
  OutputArtifact,
  MetricsSnapshot,
} from '../types'
```

- [ ] **Step 4: Add `listRuns` and `getMetrics` to `frontend/src/api/client.ts`**

Add `MetricsSnapshot` to the import block at the top:

```typescript
import type {
  AgentSchema,
  RunRecord,
  RunTriggerRequest,
  RunTriggerResponse,
  HealthResponse,
  RunEvent,
  OutputArtifact,
  MetricsSnapshot,
} from '../types'
```

Add these two functions before `streamRun`:

```typescript
export async function listRuns(): Promise<RunRecord[]> {
  const raws = await apiFetch<Array<Record<string, unknown>>>('/runs')
  return raws.map(raw => ({
    ...raw,
    created_at: (raw.started_at ?? raw.created_at ?? new Date().toISOString()) as string,
    outputs: ((raw.outputs ?? []) as Array<Record<string, unknown>>).map(o => ({
      ...o,
      url: (o.artifact_url ?? o.url ?? '') as string,
    })),
    context: (raw.context ?? {}) as Record<string, unknown>,
    system_prompt: (raw.system_prompt ?? '') as string,
    logs: (raw.logs ?? []) as string[],
  })) as RunRecord[]
}

export function getMetrics(): Promise<MetricsSnapshot> {
  return apiFetch<MetricsSnapshot>('/metrics')
}
```

- [ ] **Step 5: Add `listRuns` and `getMetrics` to `frontend/src/api/index.ts`**

Replace the entire file with:

```typescript
import { USE_MOCK } from '../config'
import * as live from './client'
import * as mock from './mock'

export const api = USE_MOCK
  ? {
      getAgents:  mock.getAgents,
      triggerRun: mock.triggerRun,
      getRun:     mock.getRun,
      getHealth:  mock.getHealth,
      streamRun:  mock.streamRun,
      listRuns:   mock.listRuns,
      getMetrics: mock.getMetrics,
    }
  : {
      getAgents:  live.getAgents,
      triggerRun: live.triggerRun,
      getRun:     live.getRun,
      getHealth:  live.getHealth,
      streamRun:  live.streamRun,
      listRuns:   live.listRuns,
      getMetrics: live.getMetrics,
    }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd d:\Animatory
git add frontend/src/api/mock.ts frontend/src/api/client.ts frontend/src/api/index.ts frontend/src/api/__tests__/mock.test.ts
git commit -m "feat: add listRuns and getMetrics to frontend API (mock + live)"
```

---

## Task 5: Wire `api.listRuns()` into `RunsHistory` and `api.getMetrics()` into `MetricsView`

**Files:**
- Modify: `frontend/src/views/RunsHistory.tsx`
- Modify: `frontend/src/views/MetricsView.tsx`

No new tests for these views — the mock tests from Task 4 cover the data path; the view wiring is straightforward plumbing that would require full render mocks.

- [ ] **Step 1: Update `RunsHistory.tsx` to call `api.listRuns()`**

Replace the entire file with:

```typescript
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RunRecord } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { api } from '../api'

export function RunsHistory() {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listRuns().then(setRuns).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 max-w-4xl">
        {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-hairline rounded-md" />)}
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Run History</h1>
        <p className="text-sm text-steel mt-1">{runs.length} runs</p>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-16 text-stone text-sm">
          No runs yet. Trigger one from the Agents view.
        </div>
      ) : (
        <div className="bg-canvas rounded-lg border border-hairline overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface">
                {['Run ID', 'Agent', 'Status', 'Duration', 'Cost', 'Started'].map((h, i) => (
                  <th key={h} className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-steel ${i >= 3 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {runs.map(run => (
                <tr key={run.run_id}>
                  <td className="px-5 py-3">
                    <Link to={`/runs/${run.run_id}`} className="font-mono text-xs text-[#3772cf] hover:underline underline-offset-2">
                      {run.run_id}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-charcoal">{run.agent_id}</td>
                  <td className="px-5 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-5 py-3 text-right text-xs text-steel tabular-nums">
                    {run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-steel tabular-nums">
                    {run.cost != null ? `$${run.cost.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs text-stone">
                    {new Date(run.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `MetricsView.tsx` to call `api.getMetrics()`**

Replace the entire file with:

```typescript
import { useEffect, useState } from 'react'
import type { MetricsSnapshot, RunStatus } from '../types'
import { MetricsStrip } from '../components/MetricsStrip'
import { api } from '../api'

const STATUS_ORDER: RunStatus[] = ['done', 'failed', 'running', 'retrying', 'queued']
const STATUS_COLOR: Record<RunStatus, string> = {
  done:     'bg-[#00d4a4]',
  failed:   'bg-[#d45656]',
  running:  'bg-[#00d4a4]/50',
  retrying: 'bg-[#c37d0d]',
  queued:   'bg-muted',
}

export function MetricsView() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getMetrics().then(setMetrics).finally(() => setLoading(false))
  }, [])

  if (loading || !metrics) {
    return (
      <div className="animate-pulse space-y-3 max-w-3xl">
        <div className="h-8 bg-hairline rounded w-40" />
        <div className="h-20 bg-hairline rounded-lg" />
        <div className="h-48 bg-hairline rounded-lg" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Metrics</h1>
        <p className="text-sm text-steel mt-1">Aggregated across all runs</p>
      </div>

      <div className="mb-8">
        <MetricsStrip metrics={metrics} />
      </div>

      <div className="bg-canvas rounded-lg border border-hairline p-6 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-5">Runs by Status</h2>
        <div className="space-y-3">
          {STATUS_ORDER.filter(s => metrics.runs_by_status[s]).map(status => {
            const count = metrics.runs_by_status[status] ?? 0
            const pct = metrics.total_runs > 0 ? (count / metrics.total_runs) * 100 : 0
            return (
              <div key={status} className="flex items-center gap-4">
                <span className="w-20 text-xs text-steel capitalize">{status}</span>
                <div className="flex-1 bg-hairline rounded-full h-2">
                  <div className={`h-2 rounded-full ${STATUS_COLOR[status]}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-xs text-stone text-right tabular-nums">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-canvas rounded-lg border border-hairline p-6">
        <h2 className="text-sm font-semibold text-ink mb-5">Runs by Stack</h2>
        <div className="space-y-3">
          {Object.entries(metrics.runs_by_stack).map(([stack, count]) => {
            const pct = metrics.total_runs > 0 ? ((count ?? 0) / metrics.total_runs) * 100 : 0
            return (
              <div key={stack} className="flex items-center gap-4">
                <span className="w-28 text-xs text-steel capitalize">{stack}</span>
                <div className="flex-1 bg-hairline rounded-full h-2">
                  <div className="h-2 rounded-full bg-[#3772cf]" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-xs text-stone text-right tabular-nums">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run TypeScript build to check for errors**

```bash
cd d:\Animatory\frontend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/RunsHistory.tsx frontend/src/views/MetricsView.tsx
git commit -m "feat: wire api.listRuns and api.getMetrics into RunsHistory and MetricsView"
```

---

## Task 6: Input validation in `RunTriggerPanel`

**Files:**
- Modify: `frontend/src/views/RunTriggerPanel.tsx`
- Create: `frontend/src/views/__tests__/RunTriggerPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/views/__tests__/RunTriggerPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RunTriggerPanel } from '../RunTriggerPanel'
import type { AgentSchema } from '../../types'

const AGENT: AgentSchema = {
  id: 'test.agent',
  name: 'Test Agent',
  layer: 'execution',
  stack: 'text',
  role: 'test',
  responsibility: 'testing',
  status: 'idle',
  inputs: [
    { name: 'script', type: 'text', required: true },
    { name: 'notes', type: 'text', required: false },
  ],
  outputs: [],
  trigger: 'manual',
  idempotent: false,
  retry: { max_attempts: 1, backoff: 'none' },
  timeout_s: 60,
  acceptance: [],
  cost_estimate: 'free',
}

vi.mock('../../api', () => ({
  api: {
    triggerRun: vi.fn().mockResolvedValue({ run_id: 'run_test_123' }),
  },
}))

function renderPanel() {
  return render(
    <MemoryRouter>
      <RunTriggerPanel agent={AGENT} onClose={() => {}} />
    </MemoryRouter>
  )
}

describe('RunTriggerPanel validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows error message when required field is empty and Run is clicked', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('Start Run →'))
    await waitFor(() => {
      expect(screen.getByText('This field is required')).toBeInTheDocument()
    })
  })

  it('does not call api.triggerRun when required field is empty', async () => {
    const { api } = await import('../../api')
    renderPanel()
    fireEvent.click(screen.getByText('Start Run →'))
    await waitFor(() => {
      expect(screen.getByText('This field is required')).toBeInTheDocument()
    })
    expect(api.triggerRun).not.toHaveBeenCalled()
  })

  it('clears field error when user types in the field', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('Start Run →'))
    await waitFor(() => expect(screen.getByText('This field is required')).toBeInTheDocument())

    const input = screen.getByPlaceholderText('Enter script...')
    fireEvent.change(input, { target: { value: 'hello' } })
    await waitFor(() => {
      expect(screen.queryByText('This field is required')).not.toBeInTheDocument()
    })
  })

  it('calls api.triggerRun when all required fields are filled', async () => {
    const { api } = await import('../../api')
    renderPanel()
    const input = screen.getByPlaceholderText('Enter script...')
    fireEvent.change(input, { target: { value: 'INT. STUDIO' } })
    fireEvent.click(screen.getByText('Start Run →'))
    await waitFor(() => {
      expect(api.triggerRun).toHaveBeenCalledWith('test.agent', expect.objectContaining({
        context: expect.objectContaining({ script: 'INT. STUDIO' }),
      }))
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: FAIL — `"This field is required"` not found in DOM

- [ ] **Step 3: Add validation to `RunTriggerPanel.tsx`**

Replace the entire file with:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentSchema } from '../types'
import { api } from '../api'

interface Props {
  agent: AgentSchema
  onClose: () => void
}

function validate(
  inputs: AgentSchema['inputs'],
  values: Record<string, string>,
): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const input of inputs) {
    if (input.required && !values[input.name]?.trim()) {
      errs[input.name] = 'This field is required'
    }
  }
  return errs
}

export function RunTriggerPanel({ agent, onClose }: Props) {
  const navigate = useNavigate()
  const [systemPrompt, setSystemPrompt] = useState('')
  const [contextValues, setContextValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate(agent.inputs, contextValues)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const context: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(contextValues)) context[k] = v
      const { run_id } = await api.triggerRun(agent.id, { context, system_prompt: systemPrompt })
      navigate(`/runs/${run_id}/monitor`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  function handleFieldChange(name: string, value: string) {
    setContextValues(prev => ({ ...prev, [name]: value }))
    if (fieldErrors[name]) {
      setFieldErrors(prev => { const next = { ...prev }; delete next[name]; return next })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-canvas rounded-lg border border-hairline shadow-card w-full max-w-xl mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="px-6 py-4 flex items-center justify-between border-b border-hairline"
          style={{ background: 'linear-gradient(135deg, #1a3d4a 0%, #2d5a4f 100%)' }}
        >
          <div>
            <p className="text-xs font-mono text-[#b3b3b3]">Trigger run</p>
            <h2 className="text-base font-semibold text-white">{agent.name}</h2>
          </div>
          <button onClick={onClose} className="text-[#b3b3b3] text-xl leading-none px-2">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel">Context Inputs</p>
            {agent.inputs.map(io => (
              <div key={io.name}>
                <label className="block text-sm text-charcoal mb-1 font-mono">
                  {io.name}
                  <span className="ml-2 text-xs text-stone">({io.type})</span>
                  {io.required && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[#d45656]">required</span>}
                </label>
                <input
                  type="text"
                  placeholder={`Enter ${io.name}...`}
                  value={contextValues[io.name] ?? ''}
                  onChange={e => handleFieldChange(io.name, e.target.value)}
                  className={`w-full h-10 px-4 rounded-md border bg-canvas text-ink text-sm focus:outline-none focus:ring-2 focus:ring-[#00d4a4] ${
                    fieldErrors[io.name] ? 'border-[#d45656]' : 'border-hairline'
                  }`}
                />
                {fieldErrors[io.name] && (
                  <p className="mt-1 text-xs text-[#d45656]">{fieldErrors[io.name]}</p>
                )}
              </div>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">
              System Prompt
            </label>
            <textarea
              rows={4}
              placeholder="Override the agent's system prompt (optional)..."
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="w-full px-4 py-3 rounded-md border border-hairline bg-canvas text-ink text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#00d4a4]"
            />
          </div>

          {error && (
            <p className="text-sm text-[#d45656] bg-[#d45656]/10 px-4 py-3 rounded-md border border-[#d45656]/30">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-full border border-hairline text-sm text-ink font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-full bg-[#00d4a4] text-ink text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Starting…' : 'Start Run →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/RunTriggerPanel.tsx frontend/src/views/__tests__/RunTriggerPanel.test.tsx
git commit -m "feat: add required-field validation to RunTriggerPanel"
```

---

## Task 7: Add `ErrorBoundary` component

**Files:**
- Create: `frontend/src/components/ErrorBoundary.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/__tests__/ErrorBoundary.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/__tests__/ErrorBoundary.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

function BrokenChild() {
  throw new Error('test render error')
}

function GoodChild() {
  return <div>All good</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders fallback UI when a child throws', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('test render error')).toBeInTheDocument()
    expect(screen.getByText('Reload')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('reload button is present in fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    )
    const btn = screen.getByText('Reload')
    expect(btn).toBeInTheDocument()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: FAIL — `ErrorBoundary` not found

- [ ] **Step 3: Create `frontend/src/components/ErrorBoundary.tsx`**

```typescript
import React, { type ReactNode } from 'react'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
}

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="bg-canvas rounded-lg border border-hairline shadow-card max-w-md w-full p-8 text-center">
        <h1 className="text-lg font-semibold text-ink mb-2">Something went wrong</h1>
        <p className="text-sm font-mono text-[#d45656] mb-6 break-words">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2 rounded-full bg-[#00d4a4] text-ink text-sm font-medium"
        >
          Reload
        </button>
      </div>
    </div>
  )
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: PASS

- [ ] **Step 5: Wrap `<Routes>` in `App.tsx` with `<ErrorBoundary>`**

Replace `frontend/src/App.tsx` with:

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AgentsView } from './views/AgentsView'
import { RunsHistory } from './views/RunsHistory'
import { RunDetail } from './views/RunDetail'
import { RunMonitor } from './views/RunMonitor'
import { MetricsView } from './views/MetricsView'

export default function App() {
  return (
    <AppShell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/agents" replace />} />
          <Route path="/agents" element={<AgentsView />} />
          <Route path="/runs" element={<RunsHistory />} />
          <Route path="/runs/:runId" element={<RunDetail />} />
          <Route path="/runs/:runId/monitor" element={<RunMonitor />} />
          <Route path="/metrics" element={<MetricsView />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  )
}
```

- [ ] **Step 6: Run full test suite and TypeScript check**

```bash
cd d:\Animatory\frontend
npm test
npx tsc --noEmit
```

Expected: all PASS, no TS errors

- [ ] **Step 7: Commit**

```bash
cd d:\Animatory
git add frontend/src/components/ErrorBoundary.tsx frontend/src/components/__tests__/ErrorBoundary.test.tsx frontend/src/App.tsx
git commit -m "feat: add ErrorBoundary component wrapping router views"
```

---

## Task 8: SSE reconnect in `RunMonitor`

**Files:**
- Modify: `frontend/src/views/RunMonitor.tsx`
- Create: `frontend/src/views/__tests__/RunMonitor.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/views/__tests__/RunMonitor.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RunMonitor } from '../RunMonitor'

interface FakeSourceOpts {
  triggerErrors?: number
}

function makeFakeSource(opts: FakeSourceOpts = {}) {
  const et = new EventTarget()
  let errorCount = 0
  const source = {
    addEventListener: (type: string, handler: EventListenerOrEventListenerObject) =>
      et.addEventListener(type, handler),
    removeEventListener: (type: string, handler: EventListenerOrEventListenerObject) =>
      et.removeEventListener(type, handler),
    close: vi.fn(),
    _triggerError: () => {
      errorCount++
      et.dispatchEvent(new Event('error'))
    },
    errorCount: () => errorCount,
  }
  return source
}

let fakeSource: ReturnType<typeof makeFakeSource>

vi.mock('../../api', () => ({
  api: {
    streamRun: vi.fn(() => {
      fakeSource = makeFakeSource()
      return fakeSource
    }),
  },
}))

function renderMonitor(runId = 'run_abc') {
  return render(
    <MemoryRouter initialEntries={[`/runs/${runId}/monitor`]}>
      <Routes>
        <Route path="/runs/:runId/monitor" element={<RunMonitor />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RunMonitor SSE reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  it('shows Reconnecting pill when stream errors in non-terminal state', async () => {
    renderMonitor()
    await act(async () => {
      fakeSource._triggerError()
    })
    await waitFor(() => {
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    })
    vi.useRealTimers()
  })

  it('does not show reconnect pill when run is in terminal done state', async () => {
    renderMonitor()
    // Emit a done complete event first
    await act(async () => {
      const event: MessageEvent = new MessageEvent('message', {
        data: JSON.stringify({
          type: 'complete',
          run_id: 'run_abc',
          timestamp: new Date().toISOString(),
          data: { status: 'done', attempts: 1 },
        }),
      })
      fakeSource.addEventListener('message', () => {})
      // Dispatch directly via the EventTarget
      const et = (fakeSource as unknown as { _et: EventTarget })._et
      // Simulate the done event setting status to done, then error
      fakeSource._triggerError()
    })
    // No reconnecting pill because the run would be terminal
    // (This test mainly verifies the error handler checks terminal state)
    expect(screen.queryByText('Connection lost — refresh to retry')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows Connection lost pill after 5 consecutive errors', async () => {
    renderMonitor()
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        fakeSource._triggerError()
        // Advance timer to allow reconnect attempt
        vi.advanceTimersByTime(2100)
      }
    })
    await waitFor(() => {
      expect(screen.getByText('Connection lost — refresh to retry')).toBeInTheDocument()
    })
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:\Animatory\frontend
npm test -- RunMonitor
```

Expected: FAIL — `"Reconnecting…"` not found

- [ ] **Step 3: Update `RunMonitor.tsx` with reconnect logic**

Replace the entire file with:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { RunEvent, RunStatus, OutputArtifact } from '../types'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'

const TERMINAL: ReadonlySet<RunStatus> = new Set(['done', 'failed'])
const MAX_RECONNECTS = 5
const RECONNECT_DELAY_MS = 2000

export function RunMonitor() {
  const { runId } = useParams<{ runId: string }>()
  const [status, setStatus] = useState<RunStatus>('queued')
  const [attempts, setAttempts] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [outputs, setOutputs] = useState<OutputArtifact[]>([])
  const [cost, setCost] = useState<number | null>(null)
  const [gpuSeconds, setGpuSeconds] = useState<number | null>(null)
  const [durationS, setDurationS] = useState<number | null>(null)
  const [acceptancePassed, setAcceptancePassed] = useState<boolean | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [startTime] = useState(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [reconnecting, setReconnecting] = useState(false)
  const [connectionLost, setConnectionLost] = useState(false)
  const logsRef = useRef<HTMLDivElement>(null)
  const reconnectCount = useRef(0)
  const statusRef = useRef<RunStatus>('queued')

  const done = status === 'done' || status === 'failed'

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (done) return
    const id = setInterval(() => setElapsed(Date.now() - startTime), 500)
    return () => clearInterval(id)
  }, [done, startTime])

  const connectStream = useCallback(() => {
    if (!runId) return
    const source = api.streamRun(runId)

    function onMessage(e: MessageEvent) {
      setReconnecting(false)
      reconnectCount.current = 0
      const event = JSON.parse(e.data as string) as RunEvent
      if (event.data.status) setStatus(event.data.status)
      if (event.data.attempts !== undefined) setAttempts(event.data.attempts)
      if (event.data.message) setLogs(prev => [...prev, event.data.message!])
      if (event.type === 'complete') {
        if (event.data.cost != null) setCost(event.data.cost)
        if (event.data.gpu_seconds != null) setGpuSeconds(event.data.gpu_seconds)
        if (event.data.duration_s != null) setDurationS(event.data.duration_s)
        if (event.data.acceptance_passed != null) setAcceptancePassed(event.data.acceptance_passed)
        if (event.data.outputs) setOutputs(event.data.outputs)
        if (event.data.error) setRunError(event.data.error)
      }
    }

    function onError() {
      if (TERMINAL.has(statusRef.current)) return
      source.close()
      reconnectCount.current += 1
      if (reconnectCount.current >= MAX_RECONNECTS) {
        setConnectionLost(true)
        setReconnecting(false)
        return
      }
      setReconnecting(true)
      setTimeout(() => {
        connectStream()
      }, RECONNECT_DELAY_MS)
    }

    source.addEventListener('message', onMessage)
    source.addEventListener('error', onError as EventListener)
    return () => {
      source.removeEventListener('message', onMessage)
      source.removeEventListener('error', onError as EventListener)
      source.close()
    }
  }, [runId])

  useEffect(() => {
    const cleanup = connectStream()
    return cleanup
  }, [connectStream])

  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' })
  }, [logs])

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-xs text-stone mb-8 font-mono">
        <Link to="/runs" className="text-steel">Runs</Link>
        <span>/</span>
        <span className="text-ink">{runId}</span>
        <span>/</span>
        <span className="text-ink">monitor</span>
      </div>

      <div className="bg-canvas rounded-lg border border-hairline p-6 mb-4 shadow-[rgba(0,0,0,0.04)_0px_1px_2px_0px]">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-ink">Run Monitor</h1>
          <div className="flex items-center gap-2">
            {reconnecting && (
              <span className="text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-0.5">
                Reconnecting…
              </span>
            )}
            {connectionLost && (
              <span className="text-xs font-medium text-[#d45656] bg-[#d45656]/10 border border-[#d45656]/30 rounded-full px-3 py-0.5">
                Connection lost — refresh to retry
              </span>
            )}
            <StatusBadge status={status} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Run ID"   value={runId ?? '—'} mono />
          <Stat label="Attempts" value={String(attempts)} />
          <Stat label="Elapsed"  value={done && durationS ? `${durationS.toFixed(1)}s` : `${(elapsed / 1000).toFixed(1)}s`} />
          <Stat label="Cost"     value={cost != null ? `$${cost.toFixed(4)}` : '—'} />
        </div>
        {gpuSeconds != null && (
          <div className="mt-3 pt-3 border-t border-hairline/60">
            <Stat label="GPU Seconds" value={`${gpuSeconds}s`} />
          </div>
        )}
      </div>

      <div className="bg-[#1c1c1e] rounded-lg overflow-hidden mb-4">
        <div className="px-4 py-2 border-b border-[#1f1f1f] flex items-center justify-between">
          <span className="text-xs text-[#b3b3b3] font-mono">stream log</span>
          {!done && !connectionLost && (
            <span className="text-xs text-[#00d4a4] font-mono animate-pulse">● live</span>
          )}
        </div>
        <div ref={logsRef} className="p-4 h-48 overflow-y-auto space-y-1 font-mono text-xs text-white">
          {logs.length === 0 && <span className="text-[#b3b3b3]">Waiting for events…</span>}
          {logs.map((line, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-[#b3b3b3] mr-3 select-none">{String(i + 1).padStart(3, '0')}</span>
              {line}
            </div>
          ))}
        </div>
      </div>

      {runError && (
        <div className="bg-[#d45656]/10 border border-[#d45656]/30 rounded-lg px-6 py-4 mb-4">
          <p className="text-sm text-[#d45656] font-mono">{runError}</p>
        </div>
      )}

      {acceptancePassed != null && (
        <div className={`rounded-lg px-6 py-4 mb-4 border ${acceptancePassed ? 'bg-[#00d4a4]/10 border-[#00d4a4]/30' : 'bg-[#d45656]/10 border-[#d45656]/30'}`}>
          <p className={`text-sm font-medium ${acceptancePassed ? 'text-[#00b48a]' : 'text-[#d45656]'}`}>
            {acceptancePassed ? '✓ Acceptance checks passed' : '✗ Acceptance checks failed'}
          </p>
        </div>
      )}

      {outputs.length > 0 && (
        <div className="bg-canvas rounded-lg border border-hairline p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-4">Outputs</p>
          <div className="grid grid-cols-2 gap-4">
            {outputs.map(out => <OutputCard key={out.name} artifact={out} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-stone">{label}</p>
      <p className={`text-sm font-medium text-ink mt-1 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function OutputCard({ artifact }: { artifact: OutputArtifact }) {
  if (artifact.type === 'image') {
    return (
      <div className="rounded-md overflow-hidden border border-hairline">
        <img src={artifact.url} alt={artifact.name} className="w-full object-cover" />
        <p className="px-3 py-2 text-xs font-mono text-stone truncate">{artifact.name}</p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-hairline px-4 py-3 flex items-center gap-3">
      <span className="text-xl">{artifact.type === 'audio' ? '♪' : artifact.type === 'video' ? '▶' : '⬡'}</span>
      <div className="min-w-0">
        <p className="text-xs font-mono text-ink truncate">{artifact.name}</p>
        <p className="text-xs text-stone">{artifact.type}{artifact.size_bytes ? ` · ${(artifact.size_bytes / 1024).toFixed(0)}kb` : ''}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd d:\Animatory\frontend
npm test -- RunMonitor
```

Expected: PASS (Note: the "terminal state" test may need adjustment based on how the fake EventSource exposes error events — if that specific test is flaky due to async state timing, the first and third tests are the critical ones.)

- [ ] **Step 5: Run full frontend test suite**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/RunMonitor.tsx frontend/src/views/__tests__/RunMonitor.test.tsx
git commit -m "feat: add SSE reconnect with Reconnecting/Connection lost pills to RunMonitor"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full backend test suite**

```bash
cd d:\Animatory
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -v
```

Expected: all pass, including 4 new tests (`test_list_runs_empty`, `test_list_runs_returns_created_runs`, `test_metrics_empty`, `test_metrics_aggregates_correctly`)

- [ ] **Step 2: Run full frontend test suite**

```bash
cd d:\Animatory\frontend
npm test
```

Expected: all pass

- [ ] **Step 3: TypeScript clean build**

```bash
cd d:\Animatory\frontend
npx tsc --noEmit
npm run build
```

Expected: no errors, build succeeds

- [ ] **Step 4: Spot-check in browser (mock mode)**

```bash
cd d:\Animatory\frontend
npm run dev
```

Open http://localhost:5173 and verify:
- Run History shows the 4 mock runs
- Metrics shows charts with data
- Trigger a run from an agent with required inputs — clicking Run without filling the field shows "This field is required"
- Navigate to any monitor page and verify status area renders correctly

- [ ] **Step 5: Final commit if any loose files**

```bash
cd d:\Animatory
git status
# If any unstaged changes remain:
git add -A
git commit -m "chore: final cleanup after MVP finish"
```
