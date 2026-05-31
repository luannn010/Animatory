# Animatory Frontend MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully-clickable React + Vite + TypeScript SPA that lets users browse the animation agent pipeline, trigger runs, monitor live SSE streams, and review run history — running entirely against mocks with zero backend dependency.

**Architecture:** Single-page app with React Router for navigation, a centralized `src/api/` layer that switches between live fetch and mock fixtures via `VITE_USE_MOCK`, and Tailwind CSS custom-configured with the Animatory design tokens. All views are pure display components fed by typed hooks; no global state library needed at MVP scale.

**Tech Stack:** React 18, Vite 5, TypeScript 5, React Router 6, Tailwind CSS 3, @fontsource/inter + geist font CDN.

---

## File Map

```
d:\Animatory\
├── CLAUDE.md                          ← project contract (Task 1)
├── frontend/
│   ├── .env                           ← VITE_API_BASE_URL + VITE_USE_MOCK
│   ├── .env.example
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts             ← Animatory design tokens
│   ├── tsconfig.json
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                    ← router + shell layout
│       ├── config.ts                  ← API_BASE_URL, USE_MOCK
│       ├── types.ts                   ← AgentSchema, RunRecord, RunEvent, MetricsSnapshot
│       ├── api/
│       │   ├── client.ts              ← all fetch calls, typed
│       │   └── mock.ts                ← fixture data + fake SSE
│       ├── components/
│       │   ├── AppShell.tsx           ← header band + left nav + content area
│       │   ├── StatusBadge.tsx        ← colored pill for run status
│       │   ├── StackBadge.tsx         ← stack accent chip
│       │   └── MetricsStrip.tsx       ← cost/gpu/attempts/pass-rate bar
│       └── views/
│           ├── AgentsView.tsx         ← grouped agent cards
│           ├── AgentCard.tsx          ← single agent card
│           ├── RunTriggerPanel.tsx    ← trigger modal/panel
│           ├── RunMonitor.tsx         ← SSE live view
│           ├── RunsHistory.tsx        ← runs table
│           └── RunDetail.tsx          ← single run detail + artifacts
```

---

## Task 1: CLAUDE.md

**Files:**
- Create: `d:\Animatory\CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

```markdown
# Animatory Frontend — CLAUDE.md

## Project Purpose
A thin-client SPA to register/inspect agents in the 2D animation pipeline,
trigger runs, watch live SSE status/log streams, and review run history + metrics.
No generation logic lives here — it is a display layer over a backend HTTP API.

## Backend API Contract (fixed — do not invent new routes)

| Method | Route                        | Body / Response                              |
|--------|------------------------------|----------------------------------------------|
| GET    | /agents                      | AgentSchema[]                                |
| POST   | /agents/{agent_id}/run       | {context, system_prompt} → {run_id: string}  |
| GET    | /runs/{run_id}               | RunRecord                                    |
| GET    | /runs/{run_id}/stream        | SSE stream of RunEvent                       |
| GET    | /health                      | {ok: boolean}                                |

## Run-Record Shape (rendered by RunMonitor + RunDetail)
```ts
interface RunRecord {
  run_id: string;
  agent_id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'retrying';
  attempts: number;
  duration_s: number | null;
  cost: number | null;          // USD
  gpu_seconds: number | null;
  acceptance_passed: boolean | null;
  outputs: OutputArtifact[];
  error: string | null;
  created_at: string;           // ISO 8601
  logs: string[];
}
```

## API Base URL
Set `VITE_API_BASE_URL` in `.env`. Defaults to `http://localhost:8000`.
Set `VITE_USE_MOCK=true` to run entirely against mock fixtures (no backend needed).

## Mock Layer
`src/api/mock.ts` exports the same interface as `src/api/client.ts`.
`src/config.ts` selects which to use based on `VITE_USE_MOCK`.
The mock SSE stream emits realistic status-change events over ~8 seconds.

## Tech Stack
- React 18 + Vite 5 + TypeScript 5
- React Router 6 (SPA routing)
- Tailwind CSS 3 (configured with Animatory design tokens)
- Fonts: Inter (UI prose), Geist Mono (logs, IDs, code)

## How to Run
```bash
cd frontend
npm install
cp .env.example .env          # edit if needed; VITE_USE_MOCK=true by default
npm run dev                   # http://localhost:5173
npm run build                 # production build
npm run preview               # preview production build
```

## Component Conventions
- All API calls via `src/api/client.ts` only — never `fetch()` in components
- Design tokens from `tailwind.config.ts` — use token class names, not raw hex
- Stack accent colors: orchestration=amber, comfyui=violet, text=blue,
  audio=emerald, image=pink, video=purple, utility=slate
- Pill buttons: `rounded-full` always
- Cards: `rounded-lg border border-hairline bg-canvas`
- Header: dark teal gradient (`from-hero-dark-from to-hero-dark-to`)

## Definition of Done
- [ ] All 5 views render correctly against mock data
- [ ] RunMonitor SSE mock emits events and updates UI live
- [ ] Run trigger form POSTs (mock) and navigates to RunMonitor
- [ ] Runs history table lists mock runs, clicking opens RunDetail
- [ ] MetricsStrip shows aggregated cost/gpu/attempts/pass-rate
- [ ] `npm run build` succeeds with no type errors
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with API contract and project conventions"
```

---

## Task 2: Vite + React + TypeScript scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/.env.example`
- Create: `frontend/.env`

- [ ] **Step 1: Scaffold the project**

```bash
cd d:\Animatory
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install react-router-dom
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 2: Install fonts**

```bash
cd d:\Animatory\frontend
npm install @fontsource-variable/inter
```

- [ ] **Step 3: Create `.env.example`**

```
VITE_API_BASE_URL=http://localhost:8000
VITE_USE_MOCK=true
```

- [ ] **Step 4: Create `.env`** (copy from example)

```
VITE_API_BASE_URL=http://localhost:8000
VITE_USE_MOCK=true
```

- [ ] **Step 5: Verify scaffold runs**

```bash
cd d:\Animatory\frontend
npm run dev
```

Expected: Vite dev server starts at http://localhost:5173, default React page visible.

- [ ] **Step 6: Commit**

```bash
cd d:\Animatory
git add frontend/
git commit -m "chore: scaffold Vite + React + TS frontend"
```

---

## Task 3: Tailwind config with Animatory design tokens

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Create: `frontend/src/index.css`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Write `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'brand-green':      '#00d4a4',
        'brand-green-deep': '#00b48a',
        'brand-green-soft': '#7cebcb',
        'brand-tag':        '#3772cf',
        'brand-warn':       '#c37d0d',
        'brand-error':      '#d45656',
        'hero-dark-from':   '#1a3d4a',
        'hero-dark-to':     '#2d5a4f',
        'hero-sky-from':    '#87a8c8',
        'hero-sky-to':      '#f5e9d8',
        canvas:             '#ffffff',
        'canvas-dark':      '#0a0a0a',
        surface:            '#f7f7f7',
        'surface-soft':     '#fafafa',
        'surface-code':     '#1c1c1e',
        hairline:           '#e5e5e5',
        'hairline-soft':    '#ededed',
        'hairline-dark':    '#1f1f1f',
        ink:                '#0a0a0a',
        charcoal:           '#1c1c1e',
        slate:              '#3a3a3c',
        steel:              '#5a5a5c',
        stone:              '#888888',
        muted:              '#a8a8aa',
        'on-dark':          '#ffffff',
        'on-dark-muted':    '#b3b3b3',
        // stack accents
        'stack-orch':       '#E0A800',
        'stack-comfyui':    '#C97BE0',
        'stack-text':       '#5B8DEF',
        'stack-audio':      '#3FB68B',
        'stack-image':      '#E0529C',
        'stack-video':      '#9B7FD4',
        'stack-utility':    '#7C8AA0',
      },
      fontFamily: {
        sans:  ['InterVariable', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono:  ['"Geist Mono"', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xs:   '4px',
        sm:   '6px',
        md:   '8px',
        lg:   '12px',
        xl:   '16px',
        xxl:  '24px',
        full: '9999px',
      },
      spacing: {
        xxs:         '4px',
        xs:          '8px',
        sm:          '12px',
        md:          '16px',
        lg:          '20px',
        xl:          '24px',
        xxl:         '32px',
        xxxl:        '40px',
        'section-sm':'48px',
        section:     '64px',
        'section-lg':'96px',
        hero:        '120px',
      },
      boxShadow: {
        subtle:  'rgba(0,0,0,0.04) 0px 1px 2px 0px',
        card:    'rgba(0,0,0,0.08) 0px 4px 12px 0px',
        mockup:  'rgba(0,0,0,0.12) 0px 24px 48px -8px',
        'brand-tinted': 'rgba(0,212,164,0.08) 0px 8px 24px',
      },
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 2: Write `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import '@fontsource-variable/inter';

/* Geist Mono from CDN — add to index.html instead */

@layer base {
  html { font-family: InterVariable, Inter, sans-serif; }
  body { @apply bg-surface text-ink antialiased; }
}
```

- [ ] **Step 3: Update `index.html` to add Geist Mono**

In `frontend/index.html`, add inside `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
<title>Animatory Studio</title>
```

- [ ] **Step 4: Update `src/main.tsx`** to import index.css

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **Step 5: Verify Tailwind loads**

```bash
cd d:\Animatory\frontend
npm run dev
```

Expected: dev server starts, no CSS errors in console.

- [ ] **Step 6: Commit**

```bash
cd d:\Animatory
git add frontend/
git commit -m "chore: configure Tailwind with Animatory design tokens"
```

---

## Task 4: Types — `src/types.ts`

**Files:**
- Create: `frontend/src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
// Stack enum matches agent-framework.yaml
export type AgentStack =
  | 'orchestration'
  | 'comfyui'
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'utility'

export type AgentLayer = 'orchestration' | 'execution' | 'audit'

export type AgentStatus = 'idle' | 'running' | 'retrying' | 'done' | 'failed'

export interface AgentIO {
  name: string
  type: 'file' | 'json' | 'text' | 'audio' | 'image' | 'video' | 'ref'
  required: boolean
  path?: string
}

export interface AgentSchema {
  id: string
  name: string
  layer: AgentLayer
  stack: AgentStack
  role: string
  responsibility: string
  status: AgentStatus
  inputs: AgentIO[]
  outputs: AgentIO[]
  trigger: 'called_by_orchestrator' | 'event' | 'manual'
  idempotent: boolean
  retry: { max_attempts: number; backoff: 'none' | 'linear' | 'exponential' }
  timeout_s: number
  acceptance: string[]
  cost_estimate: string
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'retrying'

export interface OutputArtifact {
  name: string
  type: 'image' | 'video' | 'audio' | 'json' | 'file'
  url: string       // relative or absolute URL to artifact
  size_bytes?: number
}

export interface RunRecord {
  run_id: string
  agent_id: string
  status: RunStatus
  attempts: number
  duration_s: number | null
  cost: number | null          // USD
  gpu_seconds: number | null
  acceptance_passed: boolean | null
  outputs: OutputArtifact[]
  error: string | null
  created_at: string           // ISO 8601
  logs: string[]
  context: Record<string, unknown>
  system_prompt: string
}

// SSE events from GET /runs/{id}/stream
export type RunEventType = 'status' | 'log' | 'metric' | 'complete' | 'error'

export interface RunEvent {
  type: RunEventType
  run_id: string
  timestamp: string
  data: {
    status?: RunStatus
    message?: string
    attempts?: number
    cost?: number
    gpu_seconds?: number
    duration_s?: number
    acceptance_passed?: boolean
    outputs?: OutputArtifact[]
    error?: string
  }
}

export interface MetricsSnapshot {
  total_runs: number
  total_cost: number
  total_gpu_seconds: number
  avg_attempts: number
  pass_rate: number            // 0–1
  runs_by_status: Record<RunStatus, number>
  runs_by_stack: Partial<Record<AgentStack, number>>
}

export interface RunTriggerRequest {
  context: Record<string, unknown>
  system_prompt: string
}

export interface RunTriggerResponse {
  run_id: string
}

export interface HealthResponse {
  ok: boolean
}
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/types.ts
git commit -m "feat: add TypeScript types for agents, runs, and metrics"
```

---

## Task 5: Config — `src/config.ts`

**Files:**
- Create: `frontend/src/config.ts`

- [ ] **Step 1: Write `src/config.ts`**

```ts
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const USE_MOCK: boolean =
  import.meta.env.VITE_USE_MOCK === 'true'
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/config.ts
git commit -m "feat: add config with API_BASE_URL and USE_MOCK toggle"
```

---

## Task 6: API Client — `src/api/client.ts`

**Files:**
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Write `src/api/client.ts`**

```ts
import { API_BASE_URL } from '../config'
import type {
  AgentSchema,
  RunRecord,
  RunTriggerRequest,
  RunTriggerResponse,
  HealthResponse,
} from '../types'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export function getAgents(): Promise<AgentSchema[]> {
  return apiFetch<AgentSchema[]>('/agents')
}

export function triggerRun(
  agentId: string,
  body: RunTriggerRequest
): Promise<RunTriggerResponse> {
  return apiFetch<RunTriggerResponse>(`/agents/${agentId}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getRun(runId: string): Promise<RunRecord> {
  return apiFetch<RunRecord>(`/runs/${runId}`)
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}

// Returns an EventSource. Caller is responsible for closing it.
export function streamRun(runId: string): EventSource {
  return new EventSource(`${API_BASE_URL}/runs/${runId}/stream`)
}
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/api/client.ts
git commit -m "feat: add typed API client"
```

---

## Task 7: Mock layer — `src/api/mock.ts`

**Files:**
- Create: `frontend/src/api/mock.ts`

This is the largest task. It creates fixture agents (all from agent-framework.yaml) and a fake SSE emitter.

- [ ] **Step 1: Write `src/api/mock.ts`**

```ts
import type {
  AgentSchema,
  RunRecord,
  RunTriggerRequest,
  RunTriggerResponse,
  HealthResponse,
  RunEvent,
  RunStatus,
  OutputArtifact,
} from '../types'

// ── Fixture agents (sourced from agent-framework.yaml) ──────────────────────

export const MOCK_AGENTS: AgentSchema[] = [
  {
    id: 'orch.showrunner',
    name: 'Showrunner / Orchestrator',
    layer: 'orchestration',
    stack: 'orchestration',
    role: 'Producer / Script Breakdown',
    responsibility: 'Parse script, build asset breakdown, spawn tracks, gate handoffs',
    status: 'idle',
    inputs: [{ name: 'final_script', type: 'text', required: true }],
    outputs: [{ name: 'breakdown', type: 'json', required: false, path: 'breakdown.json' }],
    trigger: 'manual',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 120,
    acceptance: ['every script entity present in breakdown'],
    cost_estimate: '~$0.05 / episode',
  },
  {
    id: 'orch.editor_retake',
    name: 'Editor / Retakes Loop',
    layer: 'orchestration',
    stack: 'orchestration',
    role: 'Editor / Retakes loop',
    responsibility: 'Assemble Take-1 shots, judge timing/quality, loop retakes, emit 1st cut',
    status: 'idle',
    inputs: [{ name: 'take1_shots', type: 'video', required: true }],
    outputs: [{ name: 'first_cut', type: 'video', required: false, path: 'first_cut.mp4' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 7, backoff: 'none' },
    timeout_s: 600,
    acceptance: ['timing reads clean', 'no wrong assets', 'no puppety snapping'],
    cost_estimate: '~$0.80 / retake loop',
  },
  {
    id: 'gate.checking',
    name: 'Checking Gate',
    layer: 'orchestration',
    stack: 'orchestration',
    role: 'Checking / Final Materials Ship',
    responsibility: 'Cross-check animatic vs designs, validate completeness, package for vendor',
    status: 'idle',
    inputs: [{ name: 'all_prepro_assets', type: 'file', required: true }],
    outputs: [{ name: 'vendor_package', type: 'file', required: false, path: 'vendor_package.zip' }],
    trigger: 'called_by_orchestrator',
    idempotent: true,
    retry: { max_attempts: 1, backoff: 'none' },
    timeout_s: 60,
    acceptance: ['no omitted assets', 'no unaddressed added assets', 'package self-contained'],
    cost_estimate: '~$0.02',
  },
  {
    id: 'design.lineart',
    name: 'Design Agent — Line Art',
    layer: 'execution',
    stack: 'image',
    role: 'B&W Rough → Final Models',
    responsibility: 'Generate clean line model sheets + turnarounds (all angles)',
    status: 'idle',
    inputs: [{ name: 'breakdown', type: 'json', required: true }],
    outputs: [{ name: 'model_sheets', type: 'image', required: false, path: 'model_sheets/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'linear' },
    timeout_s: 300,
    acceptance: ['consistent identity across sheets', 'every angle present'],
    cost_estimate: '~$0.30 / character',
  },
  {
    id: 'design.color',
    name: 'Design Agent — Color',
    layer: 'execution',
    stack: 'image',
    role: 'Color Styling / BG Paint / Final Color',
    responsibility: 'Color characters & props; paint backgrounds; lighting variants',
    status: 'idle',
    inputs: [{ name: 'model_sheets', type: 'image', required: true }],
    outputs: [{ name: 'color_sheets', type: 'image', required: false, path: 'color_sheets/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'linear' },
    timeout_s: 300,
    acceptance: ['palette consistent per asset', 'wide high-res BG (2K/4K)'],
    cost_estimate: '~$0.25 / character',
  },
  {
    id: 'design.mouthchart',
    name: 'Mouth Chart Agent',
    layer: 'execution',
    stack: 'image',
    role: 'Mouth Charts / Phoneme library',
    responsibility: 'One mouth shape per phoneme x emotion; map phoneme→frames',
    status: 'idle',
    inputs: [
      { name: 'color_sheets', type: 'image', required: true },
      { name: 'xsheets', type: 'json', required: true },
    ],
    outputs: [{ name: 'mouth_charts', type: 'image', required: false, path: 'mouth_charts/' }],
    trigger: 'called_by_orchestrator',
    idempotent: true,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 120,
    acceptance: ['language-agnostic mapping', 'aligned to dialogue timing'],
    cost_estimate: '~$0.10',
  },
  {
    id: 'board.storyboard',
    name: 'Storyboard Agent',
    layer: 'execution',
    stack: 'text',
    role: 'Storyboard → Animatic',
    responsibility: 'Plan shots/poses, build timed animatic from key poses',
    status: 'idle',
    inputs: [
      { name: 'script', type: 'text', required: true },
      { name: 'predesign', type: 'image', required: false },
    ],
    outputs: [
      { name: 'animatic', type: 'video', required: false, path: 'animatic.mp4' },
      { name: 'boards', type: 'image', required: false, path: 'boards/' },
    ],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 240,
    acceptance: ['key poses only', 'camera + timing annotations present'],
    cost_estimate: '~$0.15 / scene',
  },
  {
    id: 'cast.dialogue',
    name: 'Dialogue / Casting Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'Casting / Record / Dialogue Edit',
    responsibility: 'Per-character voices, generate reads, clean clicks/breaths, X-sheets',
    status: 'idle',
    inputs: [{ name: 'script', type: 'text', required: true }],
    outputs: [
      { name: 'dialogue', type: 'audio', required: false, path: 'dialogue/' },
      { name: 'xsheets', type: 'json', required: false, path: 'xsheets.json' },
    ],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'linear' },
    timeout_s: 180,
    acceptance: ['consistent voice per character', 'timing data emitted'],
    cost_estimate: '~$0.20 / minute of dialogue',
  },
  {
    id: 'post.adr',
    name: 'ADR Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'ADR / Final Dialogue',
    responsibility: 'Spot & re-generate changed lines, final clean dialogue',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_dialogue', type: 'audio', required: false, path: 'final_dialogue.wav' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 120,
    acceptance: [],
    cost_estimate: '~$0.10',
  },
  {
    id: 'post.composer',
    name: 'Music Composer Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'Music Spot / Final Music',
    responsibility: 'Spot music placement & intent, compose final score',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_music', type: 'audio', required: false, path: 'final_music.wav' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 300,
    acceptance: [],
    cost_estimate: '~$0.40 / minute of music',
  },
  {
    id: 'post.sfx',
    name: 'SFX Agent',
    layer: 'execution',
    stack: 'audio',
    role: 'SFX Spot / Final SFX',
    responsibility: 'List needed effects, source/synthesize, place frame-accurate',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_sfx', type: 'audio', required: false, path: 'final_sfx.wav' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 180,
    acceptance: [],
    cost_estimate: '~$0.15',
  },
  {
    id: 'exec.rigging',
    name: 'Rig Build Agent',
    layer: 'execution',
    stack: 'comfyui',
    role: 'Rig Build (Harmony/Flash equivalent)',
    responsibility: 'Assemble reusable character puppet from multi-angle sheets',
    status: 'idle',
    inputs: [{ name: 'vendor_package', type: 'file', required: true }],
    outputs: [{ name: 'rigs', type: 'file', required: false, path: 'rigs/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'exponential' },
    timeout_s: 600,
    acceptance: ['all angles present', 'reusable pose library'],
    cost_estimate: '~$0.80 / character (GPU)',
  },
  {
    id: 'exec.animation',
    name: 'Animation Agent',
    layer: 'execution',
    stack: 'comfyui',
    role: 'Physical Animation + Lip-sync',
    responsibility: 'Block action, draw in-betweens (smooth), animate lip-flap',
    status: 'idle',
    inputs: [
      { name: 'rigs', type: 'file', required: true },
      { name: 'animatic', type: 'video', required: true },
      { name: 'mouth_charts', type: 'image', required: true },
      { name: 'dialogue', type: 'audio', required: true },
    ],
    outputs: [{ name: 'take1_shots', type: 'video', required: false, path: 'take1_shots/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 7, backoff: 'none' },
    timeout_s: 1800,
    acceptance: ['smooth motion (no snapping)', 'lip-flap matches dialogue'],
    cost_estimate: '~$2.50 / shot (GPU)',
  },
  {
    id: 'exec.vfx',
    name: 'VFX Agent',
    layer: 'execution',
    stack: 'comfyui',
    role: 'After-FX / Final FX',
    responsibility: 'Plus-up drawn effects into particles/glows/composites',
    status: 'idle',
    inputs: [{ name: 'first_cut', type: 'video', required: true }],
    outputs: [{ name: 'final_fx_shots', type: 'video', required: false, path: 'final_fx_shots/' }],
    trigger: 'called_by_orchestrator',
    idempotent: false,
    retry: { max_attempts: 3, backoff: 'exponential' },
    timeout_s: 900,
    acceptance: ['matches show visual style'],
    cost_estimate: '~$1.20 / shot (GPU)',
  },
  {
    id: 'exec.mix_deliver',
    name: 'Mix & Deliver Agent',
    layer: 'execution',
    stack: 'utility',
    role: 'Picture Lock / Mix / Color / Online / QC-CC / Deliver',
    responsibility: 'Lock picture, mix audio balance, color correct, QC, caption, ship',
    status: 'idle',
    inputs: [
      { name: 'final_fx_shots', type: 'video', required: true },
      { name: 'final_dialogue', type: 'audio', required: true },
      { name: 'final_music', type: 'audio', required: true },
      { name: 'final_sfx', type: 'audio', required: true },
      { name: 'credits', type: 'image', required: true },
    ],
    outputs: [{ name: 'episode_master', type: 'video', required: false, path: 'episode_master.mov' }],
    trigger: 'called_by_orchestrator',
    idempotent: true,
    retry: { max_attempts: 2, backoff: 'none' },
    timeout_s: 300,
    acceptance: ['dialogue audible over music', 'all elements present at lock'],
    cost_estimate: '~$0.10',
  },
]

// ── Fixture run records ──────────────────────────────────────────────────────

const MOCK_OUTPUTS_IMAGE: OutputArtifact[] = [
  { name: 'model_sheets/hero_front.png', type: 'image', url: 'https://placehold.co/512x512/1c1c1e/00d4a4?text=model+sheet', size_bytes: 204800 },
  { name: 'model_sheets/hero_side.png',  type: 'image', url: 'https://placehold.co/512x512/1c1c1e/00d4a4?text=side+view',   size_bytes: 189440 },
]

const MOCK_OUTPUTS_JSON: OutputArtifact[] = [
  { name: 'breakdown.json', type: 'json', url: '#', size_bytes: 4096 },
]

export const MOCK_RUNS: RunRecord[] = [
  {
    run_id: 'run_001',
    agent_id: 'orch.showrunner',
    status: 'done',
    attempts: 1,
    duration_s: 12.4,
    cost: 0.048,
    gpu_seconds: null,
    acceptance_passed: true,
    outputs: MOCK_OUTPUTS_JSON,
    error: null,
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    logs: ['Parsing script...', 'Found 14 entities', 'Breakdown complete'],
    context: { final_script: 'Episode 1 script...' },
    system_prompt: 'You are a showrunner agent.',
  },
  {
    run_id: 'run_002',
    agent_id: 'design.lineart',
    status: 'done',
    attempts: 2,
    duration_s: 184.2,
    cost: 0.31,
    gpu_seconds: null,
    acceptance_passed: true,
    outputs: MOCK_OUTPUTS_IMAGE,
    error: null,
    created_at: new Date(Date.now() - 2400_000).toISOString(),
    logs: ['Loading breakdown...', 'Generating front view...', 'Retry 1: improving consistency', 'All angles complete'],
    context: { breakdown: 'breakdown.json' },
    system_prompt: 'Generate character model sheets.',
  },
  {
    run_id: 'run_003',
    agent_id: 'exec.animation',
    status: 'failed',
    attempts: 3,
    duration_s: 420.0,
    cost: 2.12,
    gpu_seconds: 380,
    acceptance_passed: false,
    outputs: [],
    error: 'Consistency check failed: character identity drift > 15% on frames 48-96',
    created_at: new Date(Date.now() - 900_000).toISOString(),
    logs: ['Loading rigs...', 'Blocking pass done', 'In-betweens started', 'Consistency check FAILED'],
    context: { rigs: 'rigs/', animatic: 'animatic.mp4' },
    system_prompt: 'Animate shot sequence with lip-sync.',
  },
  {
    run_id: 'run_004',
    agent_id: 'cast.dialogue',
    status: 'running',
    attempts: 1,
    duration_s: null,
    cost: null,
    gpu_seconds: null,
    acceptance_passed: null,
    outputs: [],
    error: null,
    created_at: new Date(Date.now() - 120_000).toISOString(),
    logs: ['Parsing script for dialogue lines...', 'Generating voice for HERO...'],
    context: { script: 'ep1_script.txt' },
    system_prompt: 'Cast and record all dialogue.',
  },
]

// ── Mock API functions ───────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function getAgents(): Promise<AgentSchema[]> {
  await delay(300)
  return MOCK_AGENTS
}

export async function getRun(runId: string): Promise<RunRecord> {
  await delay(200)
  const run = MOCK_RUNS.find(r => r.run_id === runId)
  if (!run) throw new Error(`Run ${runId} not found`)
  return run
}

export async function triggerRun(
  agentId: string,
  _body: RunTriggerRequest
): Promise<RunTriggerResponse> {
  await delay(400)
  const run_id = `run_${Date.now()}`
  // Push a new running record so RunsHistory shows it
  MOCK_RUNS.unshift({
    run_id,
    agent_id: agentId,
    status: 'queued',
    attempts: 0,
    duration_s: null,
    cost: null,
    gpu_seconds: null,
    acceptance_passed: null,
    outputs: [],
    error: null,
    created_at: new Date().toISOString(),
    logs: [],
    context: _body.context,
    system_prompt: _body.system_prompt,
  })
  return { run_id }
}

export async function getHealth(): Promise<HealthResponse> {
  await delay(100)
  return { ok: true }
}

// ── Mock SSE: returns an EventTarget that emits RunEvent-shaped messages ─────
// Real EventSource emits MessageEvent; here we simulate with CustomEvents
// so the RunMonitor hook can subscribe in the same way.

export interface MockEventSource {
  addEventListener(type: 'message', handler: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', handler: (e: MessageEvent) => void): void
  close(): void
}

export function streamRun(runId: string): MockEventSource {
  const et = new EventTarget()
  let closed = false

  const events: Array<{ delayMs: number; event: RunEvent }> = [
    {
      delayMs: 500,
      event: { type: 'status', run_id: runId, timestamp: new Date().toISOString(),
        data: { status: 'running', attempts: 1, message: 'Agent started' } },
    },
    {
      delayMs: 1500,
      event: { type: 'log', run_id: runId, timestamp: new Date().toISOString(),
        data: { message: 'Loading inputs...' } },
    },
    {
      delayMs: 2800,
      event: { type: 'log', run_id: runId, timestamp: new Date().toISOString(),
        data: { message: 'Processing... (this may take a while for GPU agents)' } },
    },
    {
      delayMs: 4500,
      event: { type: 'status', run_id: runId, timestamp: new Date().toISOString(),
        data: { status: 'retrying', attempts: 2, message: 'Retrying: improving output quality' } },
    },
    {
      delayMs: 6500,
      event: { type: 'log', run_id: runId, timestamp: new Date().toISOString(),
        data: { message: 'Acceptance check running...' } },
    },
    {
      delayMs: 8000,
      event: { type: 'complete', run_id: runId, timestamp: new Date().toISOString(),
        data: {
          status: 'done',
          attempts: 2,
          duration_s: 7.5,
          cost: 0.22,
          gpu_seconds: 45,
          acceptance_passed: true,
          outputs: [
            { name: 'output.png', type: 'image', url: 'https://placehold.co/512x512/1a3d4a/00d4a4?text=output', size_bytes: 204800 },
          ],
        },
      },
    },
  ]

  let accumulated = 0
  for (const { delayMs, event } of events) {
    const t = delayMs
    accumulated = t
    setTimeout(() => {
      if (closed) return
      const me = new MessageEvent('message', { data: JSON.stringify(event) })
      et.dispatchEvent(me)
    }, t)
  }

  // Final close after last event
  setTimeout(() => { closed = true }, accumulated + 200)

  return {
    addEventListener: (type, handler) => et.addEventListener(type, handler as EventListener),
    removeEventListener: (type, handler) => et.removeEventListener(type, handler as EventListener),
    close: () => { closed = true },
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/api/mock.ts
git commit -m "feat: add mock API layer with all agents and fixture runs"
```

---

## Task 8: API index — `src/api/index.ts`

**Files:**
- Create: `frontend/src/api/index.ts`

This re-exports the correct implementation based on `USE_MOCK`.

- [ ] **Step 1: Write `src/api/index.ts`**

```ts
import { USE_MOCK } from '../config'
import * as live from './client'
import * as mock from './mock'

// Unified API surface — same shape whether mock or live
export const api = USE_MOCK
  ? {
      getAgents:   mock.getAgents,
      triggerRun:  mock.triggerRun,
      getRun:      mock.getRun,
      getHealth:   mock.getHealth,
      streamRun:   mock.streamRun,
    }
  : {
      getAgents:   live.getAgents,
      triggerRun:  live.triggerRun,
      getRun:      live.getRun,
      getHealth:   live.getHealth,
      streamRun:   live.streamRun,
    }
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/api/index.ts
git commit -m "feat: add API index that switches mock/live via USE_MOCK"
```

---

## Task 9: Shared components

**Files:**
- Create: `frontend/src/components/StatusBadge.tsx`
- Create: `frontend/src/components/StackBadge.tsx`
- Create: `frontend/src/components/MetricsStrip.tsx`

- [ ] **Step 1: Write `src/components/StatusBadge.tsx`**

```tsx
import type { RunStatus } from '../types'

const STATUS_STYLES: Record<RunStatus, string> = {
  queued:   'bg-surface text-steel border-hairline',
  running:  'bg-brand-green/10 text-brand-green-deep border-brand-green/30',
  retrying: 'bg-brand-warn/10 text-brand-warn border-brand-warn/30',
  done:     'bg-brand-green/10 text-brand-green-deep border-brand-green/30',
  failed:   'bg-brand-error/10 text-brand-error border-brand-error/30',
}

const STATUS_DOT: Record<RunStatus, string> = {
  queued:   'bg-stone',
  running:  'bg-brand-green animate-pulse',
  retrying: 'bg-brand-warn animate-pulse',
  done:     'bg-brand-green',
  failed:   'bg-brand-error',
}

interface Props { status: RunStatus }

export function StatusBadge({ status }: Props) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {status}
    </span>
  )
}
```

- [ ] **Step 2: Write `src/components/StackBadge.tsx`**

```tsx
import type { AgentStack } from '../types'

const STACK_STYLES: Record<AgentStack, { bg: string; text: string; label: string }> = {
  orchestration: { bg: 'bg-[#E0A800]/15', text: 'text-[#b88400]', label: 'Orchestration' },
  comfyui:       { bg: 'bg-[#C97BE0]/15', text: 'text-[#9b4fbb]', label: 'ComfyUI' },
  text:          { bg: 'bg-[#5B8DEF]/15', text: 'text-[#3565cc]', label: 'Text / LLM' },
  audio:         { bg: 'bg-[#3FB68B]/15', text: 'text-[#1d8f68]', label: 'Audio' },
  image:         { bg: 'bg-[#E0529C]/15', text: 'text-[#b8236e]', label: 'Image Gen' },
  video:         { bg: 'bg-[#9B7FD4]/15', text: 'text-[#6b4daa]', label: 'Video' },
  utility:       { bg: 'bg-[#7C8AA0]/15', text: 'text-[#4a5568]', label: 'Utility' },
}

export const STACK_BORDER: Record<AgentStack, string> = {
  orchestration: 'border-l-[#E0A800]',
  comfyui:       'border-l-[#C97BE0]',
  text:          'border-l-[#5B8DEF]',
  audio:         'border-l-[#3FB68B]',
  image:         'border-l-[#E0529C]',
  video:         'border-l-[#9B7FD4]',
  utility:       'border-l-[#7C8AA0]',
}

interface Props { stack: AgentStack }

export function StackBadge({ stack }: Props) {
  const s = STACK_STYLES[stack]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-mono font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}
```

- [ ] **Step 3: Write `src/components/MetricsStrip.tsx`**

```tsx
import type { MetricsSnapshot } from '../types'

interface Props { metrics: MetricsSnapshot }

export function MetricsStrip({ metrics }: Props) {
  const passRate = (metrics.pass_rate * 100).toFixed(0)
  const cost = metrics.total_cost.toFixed(3)
  const gpu = metrics.total_gpu_seconds.toFixed(0)
  const avgAttempts = metrics.avg_attempts.toFixed(1)

  return (
    <div className="flex items-center gap-0 divide-x divide-hairline border border-hairline rounded-lg bg-canvas overflow-hidden text-sm">
      <Metric label="Total Cost" value={`$${cost}`} />
      <Metric label="GPU Seconds" value={`${gpu}s`} />
      <Metric label="Avg Attempts" value={avgAttempts} />
      <Metric label="Pass Rate" value={`${passRate}%`}
        valueClass={metrics.pass_rate >= 0.8 ? 'text-brand-green-deep' : 'text-brand-error'} />
      <Metric label="Total Runs" value={String(metrics.total_runs)} />
    </div>
  )
}

function Metric({ label, value, valueClass = 'text-ink' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col items-center px-xl py-sm min-w-[80px]">
      <span className={`font-semibold tabular-nums ${valueClass}`}>{value}</span>
      <span className="text-xs text-stone mt-0.5">{label}</span>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd d:\Animatory
git add frontend/src/components/
git commit -m "feat: add StatusBadge, StackBadge, MetricsStrip components"
```

---

## Task 10: App shell — `AppShell.tsx` + `App.tsx`

**Files:**
- Create: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write `src/components/AppShell.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import { USE_MOCK } from '../config'

const NAV_ITEMS = [
  { to: '/agents', label: 'Agents', icon: '⬡' },
  { to: '/runs',   label: 'Runs',   icon: '▶' },
  { to: '/metrics',label: 'Metrics',icon: '◈' },
]

interface Props { children: React.ReactNode }

export function AppShell({ children }: Props) {
  return (
    <div className="flex flex-col min-h-screen bg-surface">
      {/* Header band — dark teal gradient */}
      <header
        className="px-xxl py-md flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #1a3d4a 0%, #2d5a4f 100%)' }}
      >
        <div className="flex items-center gap-sm">
          <span className="text-brand-green font-bold text-lg tracking-tight">Animatory</span>
          <span className="text-on-dark-muted text-sm font-mono">/ studio</span>
        </div>
        <div className="flex items-center gap-xs">
          {USE_MOCK && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-brand-warn/20 text-brand-warn border border-brand-warn/30">
              mock
            </span>
          )}
          <span className="text-on-dark-muted text-xs font-mono">agent pipeline</span>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Left nav */}
        <nav className="w-52 shrink-0 border-r border-hairline bg-canvas py-xl px-xs flex flex-col gap-xxs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel px-md pb-xs">
            Studio
          </p>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-sm px-md py-xs rounded-sm text-sm transition-colors ${
                  isActive
                    ? 'bg-surface text-ink font-medium'
                    : 'text-steel hover:text-ink'
                }`
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-xxl">
          {children}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AgentsView } from './views/AgentsView'
import { RunsHistory } from './views/RunsHistory'
import { RunDetail } from './views/RunDetail'
import { RunMonitor } from './views/RunMonitor'
import { MetricsView } from './views/MetricsView'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/agents" element={<AgentsView />} />
        <Route path="/runs" element={<RunsHistory />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="/runs/:runId/monitor" element={<RunMonitor />} />
        <Route path="/metrics" element={<MetricsView />} />
      </Routes>
    </AppShell>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd d:\Animatory
git add frontend/src/components/AppShell.tsx frontend/src/App.tsx
git commit -m "feat: add app shell with dark teal header and left nav"
```

---

## Task 11: AgentsView + AgentCard + RunTriggerPanel

**Files:**
- Create: `frontend/src/views/AgentsView.tsx`
- Create: `frontend/src/views/AgentCard.tsx`
- Create: `frontend/src/views/RunTriggerPanel.tsx`

- [ ] **Step 1: Write `src/views/AgentCard.tsx`**

```tsx
import { useState } from 'react'
import type { AgentSchema } from '../types'
import { StackBadge, STACK_BORDER } from '../components/StackBadge'
import { RunTriggerPanel } from './RunTriggerPanel'

interface Props { agent: AgentSchema }

export function AgentCard({ agent }: Props) {
  const [showTrigger, setShowTrigger] = useState(false)

  return (
    <>
      <div className={`bg-canvas rounded-lg border border-hairline border-l-4 ${STACK_BORDER[agent.stack]} shadow-subtle`}>
        {/* Card header */}
        <div className="flex items-start justify-between gap-md px-xl pt-xl pb-md">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-xs flex-wrap mb-xxs">
              <StackBadge stack={agent.stack} />
              <span className="text-xs font-mono text-stone">{agent.id}</span>
            </div>
            <h3 className="text-base font-semibold text-ink leading-snug">{agent.name}</h3>
            <p className="text-xs text-steel mt-xxs">{agent.role}</p>
          </div>
          <button
            onClick={() => setShowTrigger(true)}
            className="shrink-0 px-md py-xs rounded-full bg-ink text-on-dark text-xs font-medium transition-colors"
          >
            Run
          </button>
        </div>

        {/* Responsibility */}
        <div className="px-xl pb-md">
          <p className="text-sm text-charcoal leading-relaxed">{agent.responsibility}</p>
        </div>

        {/* I/O */}
        <div className="grid grid-cols-2 gap-xs px-xl pb-xl border-t border-hairline-soft pt-md">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-xs">Inputs</p>
            <ul className="space-y-xxs">
              {agent.inputs.map(io => (
                <li key={io.name} className="flex items-center gap-xs">
                  <span className="font-mono text-xs text-charcoal">{io.name}</span>
                  <span className="text-xs text-stone font-mono">{io.type}</span>
                  {io.required && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1 py-px rounded-xs bg-brand-error text-on-dark">req</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-xs">Outputs</p>
            <ul className="space-y-xxs">
              {agent.outputs.map(io => (
                <li key={io.name} className="flex items-center gap-xs">
                  <span className="font-mono text-xs text-charcoal">{io.name}</span>
                  <span className="text-xs text-stone font-mono">{io.type}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Acceptance footer */}
        {agent.acceptance.length > 0 && (
          <div className="px-xl pb-md border-t border-hairline-soft pt-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-xs">Acceptance</p>
            <ul className="space-y-xxs">
              {agent.acceptance.map(a => (
                <li key={a} className="flex items-start gap-xs text-xs text-steel">
                  <span className="text-brand-green mt-px">✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showTrigger && (
        <RunTriggerPanel agent={agent} onClose={() => setShowTrigger(false)} />
      )}
    </>
  )
}
```

- [ ] **Step 2: Write `src/views/RunTriggerPanel.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentSchema } from '../types'
import { api } from '../api'

interface Props {
  agent: AgentSchema
  onClose: () => void
}

export function RunTriggerPanel({ agent, onClose }: Props) {
  const navigate = useNavigate()
  const [systemPrompt, setSystemPrompt] = useState('')
  const [contextValues, setContextValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const context: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(contextValues)) {
        context[k] = v
      }
      const { run_id } = await api.triggerRun(agent.id, { context, system_prompt: systemPrompt })
      navigate(`/runs/${run_id}/monitor`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40" onClick={onClose}>
      <div
        className="bg-canvas rounded-lg border border-hairline shadow-card w-full max-w-xl mx-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div
          className="px-xl py-md flex items-center justify-between border-b border-hairline"
          style={{ background: 'linear-gradient(135deg, #1a3d4a 0%, #2d5a4f 100%)' }}
        >
          <div>
            <p className="text-xs font-mono text-on-dark-muted">Trigger run</p>
            <h2 className="text-base font-semibold text-on-dark">{agent.name}</h2>
          </div>
          <button onClick={onClose} className="text-on-dark-muted text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-xl space-y-lg">
          {/* Context inputs — one field per declared input */}
          <div className="space-y-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel">Context Inputs</p>
            {agent.inputs.map(io => (
              <div key={io.name}>
                <label className="block text-sm text-charcoal mb-xxs font-mono">
                  {io.name}
                  <span className="ml-xs text-xs text-stone">({io.type})</span>
                  {io.required && <span className="ml-xs text-[10px] font-semibold uppercase tracking-wide text-brand-error">required</span>}
                </label>
                <input
                  type="text"
                  placeholder={`Enter ${io.name}...`}
                  value={contextValues[io.name] ?? ''}
                  onChange={e => setContextValues(prev => ({ ...prev, [io.name]: e.target.value }))}
                  className="w-full h-10 px-md rounded-md border border-hairline bg-canvas text-ink text-sm focus:outline-none focus:border-brand-green focus:border-2"
                />
              </div>
            ))}
          </div>

          {/* System prompt */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-steel mb-xs">
              System Prompt
            </label>
            <textarea
              rows={4}
              placeholder="Override the agent's system prompt (optional)..."
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="w-full px-md py-sm rounded-md border border-hairline bg-canvas text-ink text-sm font-mono resize-none focus:outline-none focus:border-brand-green focus:border-2"
            />
          </div>

          {error && (
            <p className="text-sm text-brand-error bg-brand-error/10 px-md py-sm rounded-md border border-brand-error/30">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-sm pt-xs">
            <button type="button" onClick={onClose}
              className="px-lg py-xs rounded-full border border-hairline text-sm text-ink font-medium">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="px-lg py-xs rounded-full bg-brand-green text-ink text-sm font-medium disabled:opacity-50">
              {loading ? 'Starting…' : 'Start Run →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/views/AgentsView.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AgentSchema, AgentStack } from '../types'
import { api } from '../api'
import { AgentCard } from './AgentCard'

const STACK_ORDER: AgentStack[] = ['orchestration', 'comfyui', 'text', 'audio', 'image', 'video', 'utility']

const STACK_LABELS: Record<AgentStack, string> = {
  orchestration: 'Orchestration',
  comfyui: 'ComfyUI / Motion',
  text: 'Text / LLM',
  audio: 'Audio',
  image: 'Image Generation',
  video: 'Video',
  utility: 'Utility',
}

export function AgentsView() {
  const [agents, setAgents] = useState<AgentSchema[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getAgents()
      .then(setAgents)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const byStack = STACK_ORDER.reduce<Partial<Record<AgentStack, AgentSchema[]>>>((acc, stack) => {
    const group = agents.filter(a => a.stack === stack)
    if (group.length > 0) acc[stack] = group
    return acc
  }, {})

  return (
    <div className="max-w-4xl">
      <div className="mb-xxl">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Agent Pipeline</h1>
        <p className="text-sm text-steel mt-xxs">{agents.length} agents across {Object.keys(byStack).length} stacks</p>
      </div>

      <div className="space-y-xxxl">
        {STACK_ORDER.filter(s => byStack[s]).map(stack => (
          <section key={stack}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-md border-b border-hairline pb-xs">
              {STACK_LABELS[stack]}
            </h2>
            <div className="space-y-md">
              {byStack[stack]!.map(agent => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-md max-w-4xl">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-40 rounded-lg bg-hairline animate-pulse" />
      ))}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-lg mx-auto mt-section text-center">
      <p className="text-brand-error text-sm">{message}</p>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/
git commit -m "feat: add AgentsView, AgentCard, RunTriggerPanel"
```

---

## Task 12: RunMonitor — live SSE view

**Files:**
- Create: `frontend/src/views/RunMonitor.tsx`

- [ ] **Step 1: Write `src/views/RunMonitor.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { RunEvent, RunRecord, RunStatus, OutputArtifact } from '../types'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'

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
  const [error, setError] = useState<string | null>(null)
  const [startTime] = useState(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const logsRef = useRef<HTMLDivElement>(null)

  // Tick elapsed timer while running
  useEffect(() => {
    if (status === 'done' || status === 'failed') return
    const id = setInterval(() => setElapsed(Date.now() - startTime), 500)
    return () => clearInterval(id)
  }, [status, startTime])

  // Subscribe to SSE stream
  useEffect(() => {
    if (!runId) return
    const source = api.streamRun(runId)

    function onMessage(e: MessageEvent) {
      const event = JSON.parse(e.data as string) as RunEvent
      if (event.data.status) setStatus(event.data.status)
      if (event.data.attempts !== undefined) setAttempts(event.data.attempts)
      if (event.data.message) setLogs(prev => [...prev, event.data.message!])
      if (event.type === 'complete') {
        if (event.data.cost !== undefined) setCost(event.data.cost ?? null)
        if (event.data.gpu_seconds !== undefined) setGpuSeconds(event.data.gpu_seconds ?? null)
        if (event.data.duration_s !== undefined) setDurationS(event.data.duration_s ?? null)
        if (event.data.acceptance_passed !== undefined) setAcceptancePassed(event.data.acceptance_passed ?? null)
        if (event.data.outputs) setOutputs(event.data.outputs)
        if (event.data.error) setError(event.data.error)
      }
    }

    source.addEventListener('message', onMessage)
    return () => {
      source.removeEventListener('message', onMessage)
      source.close()
    }
  }, [runId])

  // Auto-scroll logs
  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' })
  }, [logs])

  const done = status === 'done' || status === 'failed'

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-xs text-xs text-stone mb-xxl font-mono">
        <Link to="/runs" className="text-steel">Runs</Link>
        <span>/</span>
        <span className="text-ink">{runId}</span>
      </div>

      {/* Status header */}
      <div className="bg-canvas rounded-lg border border-hairline p-xl mb-md shadow-subtle">
        <div className="flex items-center justify-between mb-md">
          <h1 className="text-lg font-semibold text-ink">Run Monitor</h1>
          <StatusBadge status={status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-md text-sm">
          <Stat label="Run ID" value={runId ?? '—'} mono />
          <Stat label="Attempts" value={String(attempts)} />
          <Stat label="Elapsed" value={done && durationS ? `${durationS.toFixed(1)}s` : `${(elapsed / 1000).toFixed(1)}s`} />
          <Stat label="Cost" value={cost != null ? `$${cost.toFixed(4)}` : '—'} />
        </div>

        {gpuSeconds != null && (
          <div className="mt-sm pt-sm border-t border-hairline-soft">
            <Stat label="GPU Seconds" value={`${gpuSeconds}s`} />
          </div>
        )}
      </div>

      {/* Live log stream */}
      <div className="bg-surface-code rounded-lg overflow-hidden mb-md">
        <div className="px-md py-xs border-b border-hairline-dark flex items-center justify-between">
          <span className="text-xs text-on-dark-muted font-mono">stream log</span>
          {!done && <span className="text-xs text-brand-green font-mono animate-pulse">● live</span>}
        </div>
        <div ref={logsRef} className="p-md h-48 overflow-y-auto space-y-xxs font-mono text-xs text-on-dark">
          {logs.length === 0 && <span className="text-on-dark-muted">Waiting for events…</span>}
          {logs.map((line, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-on-dark-muted mr-sm select-none">{String(i + 1).padStart(3, '0')}</span>
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-brand-error/10 border border-brand-error/30 rounded-lg px-xl py-md mb-md">
          <p className="text-sm text-brand-error font-mono">{error}</p>
        </div>
      )}

      {/* Acceptance */}
      {acceptancePassed != null && (
        <div className={`rounded-lg px-xl py-md mb-md border ${acceptancePassed ? 'bg-brand-green/10 border-brand-green/30' : 'bg-brand-error/10 border-brand-error/30'}`}>
          <p className={`text-sm font-medium ${acceptancePassed ? 'text-brand-green-deep' : 'text-brand-error'}`}>
            {acceptancePassed ? '✓ Acceptance checks passed' : '✗ Acceptance checks failed'}
          </p>
        </div>
      )}

      {/* Outputs */}
      {outputs.length > 0 && (
        <div className="bg-canvas rounded-lg border border-hairline p-xl">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-md">Outputs</p>
          <div className="grid grid-cols-2 gap-md">
            {outputs.map(out => (
              <OutputCard key={out.name} artifact={out} />
            ))}
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
      <p className={`text-sm font-medium text-ink mt-xxs ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function OutputCard({ artifact }: { artifact: OutputArtifact }) {
  if (artifact.type === 'image') {
    return (
      <div className="rounded-md overflow-hidden border border-hairline">
        <img src={artifact.url} alt={artifact.name} className="w-full object-cover" />
        <p className="px-sm py-xs text-xs font-mono text-stone truncate">{artifact.name}</p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-hairline px-md py-sm flex items-center gap-sm">
      <span className="text-xl">{artifact.type === 'audio' ? '♪' : artifact.type === 'video' ? '▶' : '⬡'}</span>
      <div className="min-w-0">
        <p className="text-xs font-mono text-ink truncate">{artifact.name}</p>
        <p className="text-xs text-stone">{artifact.type}{artifact.size_bytes ? ` · ${(artifact.size_bytes / 1024).toFixed(0)}kb` : ''}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/RunMonitor.tsx
git commit -m "feat: add RunMonitor with live SSE subscription"
```

---

## Task 13: RunsHistory + RunDetail

**Files:**
- Create: `frontend/src/views/RunsHistory.tsx`
- Create: `frontend/src/views/RunDetail.tsx`

- [ ] **Step 1: Write `src/views/RunsHistory.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RunRecord } from '../types'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { MOCK_RUNS } from '../api/mock'

// Runs list: fetch all known runs from mock store
// In live mode, a GET /runs endpoint would exist; for MVP we use the mock store directly when mocked.
import { USE_MOCK } from '../config'

export function RunsHistory() {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (USE_MOCK) {
      // Give the mock store a tick to populate
      setTimeout(() => { setRuns([...MOCK_RUNS]); setLoading(false) }, 200)
    } else {
      // Live: no GET /runs in spec — show empty state until implemented
      setRuns([])
      setLoading(false)
    }
  }, [])

  if (loading) return <div className="animate-pulse space-y-sm">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-hairline rounded-md" />)}</div>

  return (
    <div className="max-w-4xl">
      <div className="mb-xxl">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Run History</h1>
        <p className="text-sm text-steel mt-xxs">{runs.length} runs</p>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-section text-stone text-sm">No runs yet. Trigger one from the Agents view.</div>
      ) : (
        <div className="bg-canvas rounded-lg border border-hairline overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface">
                <th className="text-left px-lg py-sm text-[11px] font-semibold uppercase tracking-wider text-steel">Run ID</th>
                <th className="text-left px-lg py-sm text-[11px] font-semibold uppercase tracking-wider text-steel">Agent</th>
                <th className="text-left px-lg py-sm text-[11px] font-semibold uppercase tracking-wider text-steel">Status</th>
                <th className="text-right px-lg py-sm text-[11px] font-semibold uppercase tracking-wider text-steel">Duration</th>
                <th className="text-right px-lg py-sm text-[11px] font-semibold uppercase tracking-wider text-steel">Cost</th>
                <th className="text-left px-lg py-sm text-[11px] font-semibold uppercase tracking-wider text-steel">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-soft">
              {runs.map(run => (
                <tr key={run.run_id} className="group">
                  <td className="px-lg py-md">
                    <Link to={`/runs/${run.run_id}`} className="font-mono text-xs text-brand-tag underline-offset-2 hover:underline">
                      {run.run_id}
                    </Link>
                  </td>
                  <td className="px-lg py-md font-mono text-xs text-charcoal">{run.agent_id}</td>
                  <td className="px-lg py-md"><StatusBadge status={run.status} /></td>
                  <td className="px-lg py-md text-right text-xs text-steel tabular-nums">
                    {run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-lg py-md text-right text-xs text-steel tabular-nums">
                    {run.cost != null ? `$${run.cost.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-lg py-md text-xs text-stone">
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

- [ ] **Step 2: Write `src/views/RunDetail.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { RunRecord } from '../types'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'

export function RunDetail() {
  const { runId } = useParams<{ runId: string }>()
  const [run, setRun] = useState<RunRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) return
    api.getRun(runId)
      .then(setRun)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [runId])

  if (loading) return <div className="h-64 animate-pulse bg-hairline rounded-lg" />
  if (error || !run) return <p className="text-brand-error text-sm">{error ?? 'Run not found'}</p>

  return (
    <div className="max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-xs text-xs text-stone mb-xxl font-mono">
        <Link to="/runs" className="text-steel">Runs</Link>
        <span>/</span>
        <span className="text-ink">{run.run_id}</span>
      </div>

      {/* Header */}
      <div className="bg-canvas rounded-lg border border-hairline p-xl mb-md shadow-subtle">
        <div className="flex items-center justify-between mb-md">
          <h1 className="text-lg font-semibold text-ink font-mono">{run.run_id}</h1>
          <StatusBadge status={run.status} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-md text-sm">
          <Stat label="Agent" value={run.agent_id} mono />
          <Stat label="Attempts" value={String(run.attempts)} />
          <Stat label="Duration" value={run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : '—'} />
          <Stat label="Cost" value={run.cost != null ? `$${run.cost.toFixed(4)}` : '—'} />
          {run.gpu_seconds != null && <Stat label="GPU sec" value={`${run.gpu_seconds}s`} />}
          {run.acceptance_passed != null && (
            <Stat label="Acceptance" value={run.acceptance_passed ? 'Passed ✓' : 'Failed ✗'} />
          )}
        </div>
      </div>

      {/* Logs */}
      {run.logs.length > 0 && (
        <div className="bg-surface-code rounded-lg overflow-hidden mb-md">
          <div className="px-md py-xs border-b border-hairline-dark">
            <span className="text-xs text-on-dark-muted font-mono">logs</span>
          </div>
          <div className="p-md space-y-xxs font-mono text-xs text-on-dark">
            {run.logs.map((line, i) => (
              <div key={i}>
                <span className="text-on-dark-muted mr-sm select-none">{String(i + 1).padStart(3, '0')}</span>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {run.error && (
        <div className="bg-brand-error/10 border border-brand-error/30 rounded-lg px-xl py-md mb-md">
          <p className="text-sm text-brand-error font-mono">{run.error}</p>
        </div>
      )}

      {/* Outputs */}
      {run.outputs.length > 0 && (
        <div className="bg-canvas rounded-lg border border-hairline p-xl mb-md">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-md">Outputs</p>
          <div className="grid grid-cols-2 gap-md">
            {run.outputs.map(out => (
              <div key={out.name} className="rounded-md border border-hairline overflow-hidden">
                {out.type === 'image' && <img src={out.url} alt={out.name} className="w-full" />}
                <p className="px-sm py-xs text-xs font-mono text-stone truncate">{out.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monitor link if still running */}
      {(run.status === 'running' || run.status === 'queued' || run.status === 'retrying') && (
        <Link to={`/runs/${run.run_id}/monitor`}
          className="inline-flex items-center gap-sm px-lg py-xs rounded-full bg-brand-green text-ink text-sm font-medium">
          Open Live Monitor →
        </Link>
      )}
    </div>
  )
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-stone">{label}</p>
      <p className={`text-sm font-medium text-ink mt-xxs ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/RunsHistory.tsx frontend/src/views/RunDetail.tsx
git commit -m "feat: add RunsHistory table and RunDetail view"
```

---

## Task 14: MetricsView

**Files:**
- Create: `frontend/src/views/MetricsView.tsx`

- [ ] **Step 1: Write `src/views/MetricsView.tsx`**

```tsx
import { useMemo } from 'react'
import { MOCK_RUNS } from '../api/mock'
import { USE_MOCK } from '../config'
import type { MetricsSnapshot, RunStatus, AgentStack } from '../types'
import { MetricsStrip } from '../components/MetricsStrip'
import { MOCK_AGENTS } from '../api/mock'

function computeMetrics(): MetricsSnapshot {
  const runs = USE_MOCK ? MOCK_RUNS : []
  const total_runs = runs.length
  const total_cost = runs.reduce((s, r) => s + (r.cost ?? 0), 0)
  const total_gpu_seconds = runs.reduce((s, r) => s + (r.gpu_seconds ?? 0), 0)
  const avg_attempts = total_runs > 0 ? runs.reduce((s, r) => s + r.attempts, 0) / total_runs : 0
  const completed = runs.filter(r => r.status === 'done')
  const pass_rate = completed.length > 0 ? completed.filter(r => r.acceptance_passed).length / completed.length : 0

  const runs_by_status = runs.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {} as Record<RunStatus, number>)

  const agentStackMap = Object.fromEntries(MOCK_AGENTS.map(a => [a.id, a.stack]))
  const runs_by_stack = runs.reduce((acc, r) => {
    const stack = agentStackMap[r.agent_id] as AgentStack | undefined
    if (stack) acc[stack] = (acc[stack] ?? 0) + 1
    return acc
  }, {} as Partial<Record<AgentStack, number>>)

  return { total_runs, total_cost, total_gpu_seconds, avg_attempts, pass_rate, runs_by_status, runs_by_stack }
}

const STATUS_ORDER: RunStatus[] = ['done', 'failed', 'running', 'retrying', 'queued']
const STATUS_COLORS: Record<RunStatus, string> = {
  done:     'bg-brand-green',
  failed:   'bg-brand-error',
  running:  'bg-brand-green/50',
  retrying: 'bg-brand-warn',
  queued:   'bg-muted',
}

export function MetricsView() {
  const metrics = useMemo(computeMetrics, [])

  return (
    <div className="max-w-3xl">
      <div className="mb-xxl">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Metrics</h1>
        <p className="text-sm text-steel mt-xxs">Aggregated across all runs</p>
      </div>

      <div className="mb-xxl">
        <MetricsStrip metrics={metrics} />
      </div>

      {/* Runs by status */}
      <div className="bg-canvas rounded-lg border border-hairline p-xl mb-md">
        <h2 className="text-sm font-semibold text-ink mb-lg">Runs by Status</h2>
        <div className="space-y-sm">
          {STATUS_ORDER.filter(s => metrics.runs_by_status[s]).map(status => {
            const count = metrics.runs_by_status[status] ?? 0
            const pct = metrics.total_runs > 0 ? (count / metrics.total_runs) * 100 : 0
            return (
              <div key={status} className="flex items-center gap-md">
                <span className="w-20 text-xs text-steel capitalize">{status}</span>
                <div className="flex-1 bg-hairline rounded-full h-2">
                  <div className={`h-2 rounded-full ${STATUS_COLORS[status]}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-xs text-stone text-right tabular-nums">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Runs by stack */}
      <div className="bg-canvas rounded-lg border border-hairline p-xl">
        <h2 className="text-sm font-semibold text-ink mb-lg">Runs by Stack</h2>
        <div className="space-y-sm">
          {Object.entries(metrics.runs_by_stack).map(([stack, count]) => {
            const pct = metrics.total_runs > 0 ? ((count ?? 0) / metrics.total_runs) * 100 : 0
            return (
              <div key={stack} className="flex items-center gap-md">
                <span className="w-28 text-xs text-steel capitalize">{stack}</span>
                <div className="flex-1 bg-hairline rounded-full h-2">
                  <div className="h-2 rounded-full bg-brand-tag" style={{ width: `${pct}%` }} />
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

- [ ] **Step 2: Commit**

```bash
cd d:\Animatory
git add frontend/src/views/MetricsView.tsx
git commit -m "feat: add MetricsView with cost/gpu/pass-rate summary"
```

---

## Task 15: Wire up routes + verify build

**Files:**
- Verify: `frontend/src/App.tsx` (already written in Task 10)

- [ ] **Step 1: Run dev server and click through all views**

```bash
cd d:\Animatory\frontend
npm run dev
```

Expected: open http://localhost:5173
- `/agents` — shows all 15 agents grouped by stack with colored left borders
- Click "Run" on any agent — trigger panel opens with input fields + system prompt textarea
- Submit form — navigates to `/runs/<id>/monitor`, logs stream in over ~8s, outputs appear
- `/runs` — table shows 4 fixture runs + any newly triggered
- Click a run ID — RunDetail view loads with logs and outputs
- `/metrics` — MetricsStrip + bar charts render

- [ ] **Step 2: Type-check**

```bash
cd d:\Animatory\frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Production build**

```bash
cd d:\Animatory\frontend
npm run build
```

Expected: `dist/` created, no build errors.

- [ ] **Step 4: Final commit**

```bash
cd d:\Animatory
git add .
git commit -m "feat: complete Animatory frontend MVP — all views, mock layer, SSE monitor"
```

---

## Self-Review

### Spec Coverage Check

| Requirement | Covered by |
|---|---|
| CLAUDE.md with API contract | Task 1 |
| Vite + React + TS scaffold | Task 2 |
| Tailwind with Animatory tokens | Task 3 |
| `src/types.ts` — AgentSchema, RunRecord, RunEvent, MetricsSnapshot | Task 4 |
| `src/config.ts` — API_BASE_URL, USE_MOCK | Task 5 |
| `src/api/client.ts` — all 5 routes typed | Task 6 |
| `src/api/mock.ts` — all 15 agents, fixture runs, fake SSE | Task 7 |
| `src/api/index.ts` — mock/live toggle | Task 8 |
| StatusBadge, StackBadge, MetricsStrip | Task 9 |
| AppShell — dark teal header, left nav | Task 10 |
| AgentsView — grouped by stack, stack-colored | Task 11 |
| AgentCard — role/responsibility/inputs/outputs | Task 11 |
| RunTriggerPanel — input form + system prompt + POST | Task 11 |
| RunMonitor — SSE, live status/attempts/elapsed/logs, outputs | Task 12 |
| RunsHistory — table with status/cost/duration | Task 13 |
| RunDetail — single run, logs, artifacts | Task 13 |
| MetricsView — cost/gpu/attempts/pass-rate | Task 14 |
| `npm run build` passes | Task 15 |
| Mock toggleable via `VITE_USE_MOCK` | Tasks 5, 7, 8 |

### Type Consistency Check
- `api.streamRun()` returns `MockEventSource | EventSource` — both have `addEventListener`/`removeEventListener`/`close`. RunMonitor calls these uniformly. ✓
- `MOCK_RUNS` is exported from `mock.ts` and imported in `RunsHistory` and `MetricsView` — consistent module path `../api/mock`. ✓
- `MOCK_AGENTS` used in `MetricsView` — imported from `../api/mock`. ✓
- `STACK_BORDER` exported from `StackBadge` and used in `AgentCard`. ✓
- All `RunStatus` values (`queued | running | done | failed | retrying`) used consistently across `StatusBadge`, `RunMonitor`, `RunDetail`, `MetricsView`. ✓

### No Placeholders
Scanned — no TBD, TODO, or vague steps found. ✓
