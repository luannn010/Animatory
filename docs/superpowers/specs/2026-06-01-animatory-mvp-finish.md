# Animatory MVP Finish — Design Spec

**Date:** 2026-06-01
**Scope:** 5 remaining high-priority items from IMPROVEMENTS.md
**Approach:** Option A (all 5 together), TDD throughout

---

## Goals

1. Add `GET /runs` backend endpoint → fix empty RunsHistory in live mode
2. Add `GET /metrics` backend endpoint → fix empty MetricsView in live mode
3. Input validation in RunTriggerPanel → block submit on missing required fields
4. Error boundary around router views → graceful crash recovery
5. SSE reconnect in RunMonitor → silent retry with UX indicator

---

## 1. Backend: `GET /runs`

### Run store change
Add `list_runs() -> list[RunRecord]` to both store implementations:

- `InMemoryRunStore.list_runs()` — return `list(self._store.values())`
- `SQLiteRunStore.list_runs()` — `SELECT * FROM runs ORDER BY started_at DESC`

### Route
```
GET /runs
Response: RunRecord[]   (same shape as GET /runs/{run_id})
Status: 200
```

No pagination. Returns all runs, newest first.

### TDD
File: `tests/test_api.py`

1. **RED** `test_list_runs_empty` — GET /runs on fresh store → 200, body `[]`
2. **RED** `test_list_runs_returns_created_runs` — trigger 2 runs, GET /runs → both present
3. Watch each fail → implement `list_runs()` on store + route → GREEN

---

## 2. Backend: `GET /metrics`

### Route
```
GET /metrics
Response: MetricsSnapshot
Status: 200
```

Computed server-side from `list_runs()`. No DB aggregation — Python loop for MVP.

### MetricsSnapshot shape
```json
{
  "total_runs": 12,
  "total_cost": 0.048,
  "total_gpu_seconds": 148.2,
  "avg_attempts": 1.25,
  "pass_rate": 0.83,
  "runs_by_status": {"done": 10, "failed": 2},
  "runs_by_stack": {"comfyui": 7, "text": 3}
}
```

`pass_rate` = runs where `acceptance_passed == True` / total runs (0.0 if no runs).
`avg_attempts` = mean of `attempts` across all runs (0.0 if no runs).
`runs_by_stack` derived by calling `registry.get_agent(run.agent_id).stack` for each run (registry available via `app.state.registry`); falls back to `"unknown"` if agent not found.

### TDD
File: `tests/test_api.py`

1. **RED** `test_metrics_empty` — GET /metrics on fresh store → 200, all zeros
2. **RED** `test_metrics_aggregates_correctly` — seed 3 known runs, assert exact values
3. Watch fail → implement Pydantic `MetricsSnapshot` model + route → GREEN

---

## 3. Frontend: `listRuns` + `getMetrics` API methods

### client.ts additions
```ts
listRuns(): Promise<RunRecord[]>   // GET /runs, normalize each record
getMetrics(): Promise<MetricsSnapshot>  // GET /metrics
```

`listRuns` normalizes each record the same way `getRun` does (started_at → created_at, artifact_url → url).

### mock.ts additions
```ts
listRuns(): Promise<RunRecord[]>  // return MOCK_RUNS
getMetrics(): Promise<MetricsSnapshot>  // compute from MOCK_RUNS (existing logic)
```

### api/index.ts
Export `listRuns` and `getMetrics` switching on `USE_MOCK`.

### RunsHistory.tsx
Replace direct `MOCK_RUNS` import with:
```ts
const [runs, setRuns] = useState<RunRecord[]>([])
useEffect(() => { api.listRuns().then(setRuns) }, [])
```
Show loading state ("Loading runs…") while fetching.

### types.ts addition
Add `MetricsSnapshot` interface (not currently exported from types.ts — only used inline in mock.ts):
```ts
export interface MetricsSnapshot {
  total_runs: number
  total_cost: number
  total_gpu_seconds: number
  avg_attempts: number
  pass_rate: number
  runs_by_status: Record<string, number>
  runs_by_stack: Record<string, number>
}
```

### MetricsView.tsx
Replace inline computation with:
```ts
const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
useEffect(() => { api.getMetrics().then(setMetrics) }, [])
```
Show loading state while null.

### TDD (Vitest + @testing-library/react + jsdom)
Add to `frontend/package.json` devDeps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

Tests in `frontend/src/api/__tests__/mock.test.ts`:
1. **RED** `listRuns returns array matching RunRecord shape`
2. **RED** `getMetrics returns MetricsSnapshot with correct pass_rate`
3. Watch fail → implement → GREEN

---

## 4. Frontend: Input Validation in RunTriggerPanel

### Behavior
- On submit click: run `validate(inputs, formValues)` → `Record<string, string>` (field → error)
- If any errors: set `errors` state, render red "This field is required" under each bad input, block `api.triggerRun`
- If no errors: proceed as before
- Clear individual field error on change

### validate function (inline, not extracted)
```ts
function validate(inputs: AgentInput[], values: Record<string, string>) {
  const errs: Record<string, string> = {}
  for (const input of inputs) {
    if (input.required && !values[input.name]?.trim()) {
      errs[input.name] = 'This field is required'
    }
  }
  return errs
}
```

### TDD
Tests in `frontend/src/views/__tests__/RunTriggerPanel.test.tsx`:
1. **RED** `blocks submission when required field is empty` — render panel, click Run, expect error message visible
2. **RED** `allows submission when all required fields filled` — fill fields, click Run, expect `api.triggerRun` called
3. Watch fail → implement → GREEN

---

## 5. Frontend: Error Boundary

### Component
New file: `frontend/src/components/ErrorBoundary.tsx`

Class component (React requires class for error boundaries):
```tsx
class ErrorBoundary extends React.Component<{children: ReactNode}, {error: Error | null}> {
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} />
    return this.props.children
  }
}
```

`ErrorFallback` — centered card, dark theme consistent with design system:
- "Something went wrong" heading
- `error.message` in Geist Mono
- "Reload" button → `window.location.reload()`

### Placement
Wrap `<Routes>` in `App.tsx` (or wherever the router lives):
```tsx
<ErrorBoundary>
  <Routes>...</Routes>
</ErrorBoundary>
```

### TDD
Tests in `frontend/src/components/__tests__/ErrorBoundary.test.tsx`:
1. **RED** `renders children when no error`
2. **RED** `renders fallback when child throws`
3. Watch fail → implement → GREEN

---

## 6. Frontend: SSE Reconnect in RunMonitor

### Behavior
- Terminal states: `done`, `failed` — no reconnect
- On `onerror` in non-terminal state:
  - Increment `reconnectCount` ref
  - If `reconnectCount < 5`: show "Reconnecting…" pill in status area, wait 2s, reconnect fresh
  - If `reconnectCount >= 5`: stop, show "Connection lost — refresh to retry" pill
- On successful reconnect: clear "Reconnecting…" pill, resume normal display
- Reconnect pill uses amber color (`text-amber-400`) to distinguish from status badges

### Implementation
```ts
const reconnectCount = useRef(0)
const [reconnecting, setReconnecting] = useState(false)
const [connectionLost, setConnectionLost] = useState(false)

// In connectStream():
source.onerror = () => {
  if (isTerminal(status)) return
  reconnectCount.current++
  if (reconnectCount.current >= 5) { setConnectionLost(true); return }
  setReconnecting(true)
  setTimeout(() => { source.close(); connectStream() }, 2000)
}
// On first message received: setReconnecting(false)
```

### TDD
Tests in `frontend/src/views/__tests__/RunMonitor.test.tsx`:
1. **RED** `shows Reconnecting pill when stream errors in non-terminal state`
2. **RED** `shows Connection lost after 5 failures`
3. **RED** `does not reconnect when run is in terminal state`
4. Watch fail → implement → GREEN

Uses a fake `EventSource` class injected via props or module mock.

---

## File Change Summary

| File | Change |
|------|--------|
| `animatory/run_store.py` | Add `list_runs()` to both store classes |
| `animatory/models.py` | Add `MetricsSnapshot` Pydantic model |
| `animatory/server.py` | Add `GET /runs` and `GET /metrics` routes |
| `tests/test_api.py` | Add 5 new tests (list_runs × 2, metrics × 2, run store) |
| `frontend/src/types.ts` | Add `MetricsSnapshot` interface |
| `frontend/package.json` | Add vitest + testing-library devDeps |
| `frontend/vite.config.ts` | Add vitest config block |
| `frontend/src/api/client.ts` | Add `listRuns`, `getMetrics` |
| `frontend/src/api/mock.ts` | Add `listRuns`, `getMetrics` |
| `frontend/src/api/index.ts` | Export `listRuns`, `getMetrics` |
| `frontend/src/views/RunsHistory.tsx` | Replace MOCK_RUNS with `api.listRuns()` |
| `frontend/src/views/MetricsView.tsx` | Replace inline compute with `api.getMetrics()` |
| `frontend/src/views/RunTriggerPanel.tsx` | Add `validate()` + error display |
| `frontend/src/components/ErrorBoundary.tsx` | New — class component + fallback |
| `frontend/src/App.tsx` | Wrap routes in `<ErrorBoundary>` |
| `frontend/src/views/RunMonitor.tsx` | Add reconnect logic + pills |
| `frontend/src/api/__tests__/mock.test.ts` | New — API mock tests |
| `frontend/src/views/__tests__/RunTriggerPanel.test.tsx` | New — validation tests |
| `frontend/src/components/__tests__/ErrorBoundary.test.tsx` | New — boundary tests |
| `frontend/src/views/__tests__/RunMonitor.test.tsx` | New — reconnect tests |

---

## Definition of Done

- [ ] `ANIMATORY_FAKE_EXECUTORS=1 pytest tests/ -v` — all pass including new tests
- [ ] `cd frontend && npx vitest run` — all pass
- [ ] `npm run build` — clean build, no TS errors
- [ ] RunsHistory shows runs in live mode
- [ ] MetricsView shows aggregated data in live mode
- [ ] RunTriggerPanel blocks submit on missing required fields
- [ ] ErrorBoundary catches thrown errors and shows fallback
- [ ] RunMonitor shows "Reconnecting…" pill on SSE drop, "Connection lost" after 5 attempts
