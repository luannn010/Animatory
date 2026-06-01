# Pipeline Canvas — Section 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat AgentsView + AgentCard list with a React Flow directed-graph canvas showing the full animation pipeline, plus a floating NodePanel with 5 tabs for detail, scenes, prompt, logs, and I/O.

**Architecture:** `PipelineCanvas` owns the React Flow canvas and derives nodes+edges from `AgentSchema[]` via `pipelineData.ts`. Clicking a node opens `NodePanel` (floating overlay). Each panel tab is a standalone component. Mock data lives in `frontend/src/mock/`. Canvas types live in `frontend/src/types/canvas.ts`.

**Tech Stack:** React 18, @xyflow/react v12, TypeScript 5, Tailwind CSS 3, existing design tokens.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Install | `@xyflow/react` | React Flow v12 pan/zoom/edges |
| Create | `frontend/src/types/canvas.ts` | CanvasNode, SceneRun, SceneFanout, PipelineState |
| Create | `frontend/src/mock/sceneMock.ts` | 5-scene fixture with mixed statuses |
| Create | `frontend/src/mock/pipelineMock.ts` | MOCK_RUNS extended with scene_id |
| Create | `frontend/src/canvas/nodeLayout.ts` | Static X/Y positions per agent id |
| Create | `frontend/src/canvas/edgeDefinitions.ts` | Hardcoded source→target edge list |
| Create | `frontend/src/canvas/pipelineData.ts` | Derives ReactFlow nodes+edges from AgentSchema[] |
| Create | `frontend/src/canvas/AgentNode.tsx` | Custom RF node: stack border, status dot, Run btn |
| Create | `frontend/src/canvas/PipelineCanvas.tsx` | ReactFlow canvas + node click → NodePanel |
| Create | `frontend/src/panel/tabs/OverviewTab.tsx` | role, responsibility, inputs/outputs, acceptance |
| Create | `frontend/src/panel/tabs/ScenesTab.tsx` | Scene pill tabs + selected scene detail + re-run |
| Create | `frontend/src/panel/tabs/PromptTab.tsx` | Editable system_prompt textarea |
| Create | `frontend/src/panel/tabs/LogsTab.tsx` | Live SSE log stream for selected scene's run |
| Create | `frontend/src/panel/tabs/IOTab.tsx` | Raw input + output side by side |
| Create | `frontend/src/panel/NodePanel.tsx` | Floating overlay, tab router |
| Modify | `frontend/src/types.ts` | Add `scene_id?: string` to RunRecord, SceneFanout export |
| Modify | `frontend/src/api/mock.ts` | Add `listRuns()`, make `triggerRun` scene-aware |
| Modify | `frontend/src/api/index.ts` | Expose `listRuns` in facade |
| Replace | `frontend/src/views/AgentsView.tsx` | Thin wrapper: loads agents, renders PipelineCanvas |
| Delete | `frontend/src/views/AgentCard.tsx` | Replaced by AgentNode + NodePanel |
| No-touch | `frontend/src/App.tsx` | Route unchanged |

---

## Task 1: Install @xyflow/react and add canvas types

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Create: `frontend/src/types/canvas.ts`

- [ ] **Step 1: Install the package**

```bash
cd frontend && npm install @xyflow/react
```

Expected: `added N packages` with `@xyflow/react` in `package.json` dependencies.

- [ ] **Step 2: Create `frontend/src/types/canvas.ts`**

```typescript
import type { AgentSchema } from '../types'

export type SceneStatus = 'queued' | 'running' | 'done' | 'failed' | 'retrying'

export interface SceneRun {
  scene_id: string
  scene_label: string   // e.g. "Scene 03 — Rooftop Chase"
  run_id: string | null // null = never triggered
  status: SceneStatus
  attempts: number
  duration_s: number | null
  cost: number | null
  acceptance_passed: boolean | null
  logs: string[]
  inputs: Record<string, unknown>
  outputs: Array<{ name: string; type: string; url: string }>
  error: string | null
}

export interface SceneFanout {
  agent_id: string
  scenes: SceneRun[]
}

export interface PipelineState {
  selectedNodeId: string | null
  panelTab: 'overview' | 'scenes' | 'prompt' | 'logs' | 'io'
}

// Extends ReactFlow's Node data payload
export interface AgentNodeData {
  agent: AgentSchema
  fanout: SceneFanout | null
}
```

- [ ] **Step 3: Add `scene_id` to RunRecord and export SceneFanout in `frontend/src/types.ts`**

Open `frontend/src/types.ts`. In the `RunRecord` interface, add one field after `logs`:

```typescript
  logs: string[]
  scene_id?: string        // which scene this run belongs to (optional)
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/types/canvas.ts frontend/src/types.ts
git commit -m "feat(canvas): install @xyflow/react, add canvas types and scene_id to RunRecord"
```

---

## Task 2: Scene mock data

**Files:**
- Create: `frontend/src/mock/sceneMock.ts`
- Create: `frontend/src/mock/pipelineMock.ts`

- [ ] **Step 1: Create `frontend/src/mock/sceneMock.ts`**

```typescript
import type { SceneFanout, SceneRun } from '../types/canvas'

function scene(
  agent_id: string,
  scene_id: string,
  label: string,
  status: SceneRun['status'],
  run_id: string | null,
  overrides: Partial<SceneRun> = {},
): SceneRun {
  return {
    scene_id,
    scene_label: label,
    run_id,
    status,
    attempts: status === 'retrying' ? 2 : 1,
    duration_s: status === 'done' ? 12.4 : null,
    cost: status === 'done' ? 0.0031 : null,
    acceptance_passed: status === 'done' ? true : null,
    logs:
      status === 'done'
        ? ['Starting…', 'Executor returned 2 outputs', 'Acceptance passed']
        : status === 'failed'
        ? ['Starting…', 'ComfyUI timeout after 300s']
        : [],
    inputs: { episode_id: 'ep01', scene_id, phase: 'animation' },
    outputs:
      status === 'done'
        ? [{ name: 'frames', type: 'image', url: '' }]
        : [],
    error: status === 'failed' ? 'ComfyUI timeout after 300s' : null,
    ...overrides,
  }
}

export const SCENE_FANOUTS: Record<string, SceneFanout> = {
  'exec.animation': {
    agent_id: 'exec.animation',
    scenes: [
      scene('exec.animation', 'sc01', 'Scene 01 — Cold Open',      'done',     'run_sc01_anim'),
      scene('exec.animation', 'sc02', 'Scene 02 — Marketplace',    'running',  'run_sc02_anim'),
      scene('exec.animation', 'sc03', 'Scene 03 — Rooftop Chase',  'queued',   null),
      scene('exec.animation', 'sc04', 'Scene 04 — Confrontation',  'failed',   'run_sc04_anim'),
      scene('exec.animation', 'sc05', 'Scene 05 — Resolution',     'retrying', 'run_sc05_anim'),
    ],
  },
  'exec.rigging': {
    agent_id: 'exec.rigging',
    scenes: [
      scene('exec.rigging', 'sc01', 'Scene 01 — Rig Build', 'done', 'run_sc01_rig'),
      scene('exec.rigging', 'sc02', 'Scene 02 — Rig Build', 'done', 'run_sc02_rig'),
    ],
  },
  'orch.showrunner': {
    agent_id: 'orch.showrunner',
    scenes: [
      scene('orch.showrunner', 'ep01', 'Episode 01 — Full Breakdown', 'done', 'run_ep01_show'),
    ],
  },
}
```

- [ ] **Step 2: Create `frontend/src/mock/pipelineMock.ts`**

```typescript
import type { RunRecord } from '../types'

// MOCK_RUNS extended with scene_id — imported by components that need per-scene history
export const PIPELINE_RUNS: RunRecord[] = [
  {
    run_id: 'run_sc01_anim',
    agent_id: 'exec.animation',
    status: 'done',
    attempts: 1,
    duration_s: 12.4,
    cost: 0.0031,
    gpu_seconds: 8.1,
    acceptance_passed: true,
    outputs: [{ name: 'frames', type: 'image', url: '' }],
    error: null,
    created_at: '2026-06-01T10:00:00Z',
    logs: ['Starting…', 'Executor returned 2 outputs', 'Acceptance passed'],
    context: { episode_id: 'ep01', scene_id: 'sc01' },
    system_prompt: '',
    scene_id: 'sc01',
  },
  {
    run_id: 'run_sc04_anim',
    agent_id: 'exec.animation',
    status: 'failed',
    attempts: 1,
    duration_s: null,
    cost: null,
    gpu_seconds: null,
    acceptance_passed: null,
    outputs: [],
    error: 'ComfyUI timeout after 300s',
    created_at: '2026-06-01T10:05:00Z',
    logs: ['Starting…', 'ComfyUI timeout after 300s'],
    context: { episode_id: 'ep01', scene_id: 'sc04' },
    system_prompt: '',
    scene_id: 'sc04',
  },
]
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/mock/sceneMock.ts frontend/src/mock/pipelineMock.ts
git commit -m "feat(canvas): add scene mock fixtures (5 scenes, mixed statuses)"
```

---

## Task 3: Node layout and edge definitions

**Files:**
- Create: `frontend/src/canvas/nodeLayout.ts`
- Create: `frontend/src/canvas/edgeDefinitions.ts`

- [ ] **Step 1: Create `frontend/src/canvas/nodeLayout.ts`**

The pipeline flows left-to-right in 4 columns. Column widths: 240px node width, 80px horizontal gap.

```typescript
// X/Y position for each agent node on the canvas.
// Layout: 4 columns, top-to-bottom within each column.
// Column 0: orchestration (x=0)
// Column 1: design+board+cast (x=320)
// Column 2: exec (x=640)
// Column 3: post (x=960)

const COL = [0, 320, 640, 960]
const ROW_H = 130

export const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  // Column 0 — Orchestration
  'orch.showrunner':    { x: COL[0], y: 0 },
  'orch.editor_retake': { x: COL[0], y: ROW_H },
  'gate.checking':      { x: COL[0], y: ROW_H * 2 },

  // Column 1 — Design / Board / Cast
  'design.lineart':     { x: COL[1], y: 0 },
  'design.color':       { x: COL[1], y: ROW_H },
  'design.mouthchart':  { x: COL[1], y: ROW_H * 2 },
  'board.storyboard':   { x: COL[1], y: ROW_H * 3 },
  'cast.dialogue':      { x: COL[1], y: ROW_H * 4 },
  'post.adr':           { x: COL[1], y: ROW_H * 5 },

  // Column 2 — Execution
  'exec.rigging':       { x: COL[2], y: 0 },
  'exec.animation':     { x: COL[2], y: ROW_H },
  'exec.vfx':           { x: COL[2], y: ROW_H * 2 },

  // Column 3 — Post
  'post.composer':      { x: COL[3], y: 0 },
  'post.sfx':           { x: COL[3], y: ROW_H },
  'exec.mix_deliver':   { x: COL[3], y: ROW_H * 2 },
}

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 110
```

- [ ] **Step 2: Create `frontend/src/canvas/edgeDefinitions.ts`**

```typescript
import type { Edge } from '@xyflow/react'

// Hardcoded directed edges derived from agent input/output matching.
// source output → target input dependency.
export const PIPELINE_EDGES: Edge[] = [
  // Showrunner spawns design track
  { id: 'e-show-lineart',   source: 'orch.showrunner',    target: 'design.lineart',     animated: false },
  { id: 'e-show-board',     source: 'orch.showrunner',    target: 'board.storyboard',   animated: false },
  { id: 'e-show-cast',      source: 'orch.showrunner',    target: 'cast.dialogue',      animated: false },

  // Design feeds rigging
  { id: 'e-lineart-color',  source: 'design.lineart',     target: 'design.color',       animated: false },
  { id: 'e-lineart-mouth',  source: 'design.lineart',     target: 'design.mouthchart',  animated: false },
  { id: 'e-lineart-rig',    source: 'design.lineart',     target: 'exec.rigging',       animated: false },

  // Rig + board + cast feeds animation
  { id: 'e-rig-anim',       source: 'exec.rigging',       target: 'exec.animation',     animated: false },
  { id: 'e-board-anim',     source: 'board.storyboard',   target: 'exec.animation',     animated: false },
  { id: 'e-cast-anim',      source: 'cast.dialogue',      target: 'exec.animation',     animated: false },
  { id: 'e-mouth-anim',     source: 'design.mouthchart',  target: 'exec.animation',     animated: false },

  // Animation → VFX → post
  { id: 'e-anim-vfx',       source: 'exec.animation',     target: 'exec.vfx',           animated: false },
  { id: 'e-anim-editor',    source: 'exec.animation',     target: 'orch.editor_retake', animated: false },

  // VFX + audio → mix
  { id: 'e-vfx-mix',        source: 'exec.vfx',           target: 'exec.mix_deliver',   animated: false },
  { id: 'e-adr-mix',        source: 'post.adr',           target: 'exec.mix_deliver',   animated: false },
  { id: 'e-comp-mix',       source: 'post.composer',      target: 'exec.mix_deliver',   animated: false },
  { id: 'e-sfx-mix',        source: 'post.sfx',           target: 'exec.mix_deliver',   animated: false },

  // Cast → ADR
  { id: 'e-cast-adr',       source: 'cast.dialogue',      target: 'post.adr',           animated: false },

  // Editor → gate
  { id: 'e-editor-gate',    source: 'orch.editor_retake', target: 'gate.checking',      animated: false },
  { id: 'e-mix-gate',       source: 'exec.mix_deliver',   target: 'gate.checking',      animated: false },
]
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/canvas/nodeLayout.ts frontend/src/canvas/edgeDefinitions.ts
git commit -m "feat(canvas): add static node layout positions and pipeline edge definitions"
```

---

## Task 4: pipelineData — derive ReactFlow nodes from AgentSchema[]

**Files:**
- Create: `frontend/src/canvas/pipelineData.ts`

- [ ] **Step 1: Create `frontend/src/canvas/pipelineData.ts`**

```typescript
import type { Node, Edge } from '@xyflow/react'
import type { AgentSchema } from '../types'
import type { AgentNodeData, SceneFanout } from '../types/canvas'
import { NODE_POSITIONS, NODE_WIDTH, NODE_HEIGHT } from './nodeLayout'
import { PIPELINE_EDGES } from './edgeDefinitions'

export function buildNodes(
  agents: AgentSchema[],
  fanouts: Record<string, SceneFanout>,
): Node<AgentNodeData>[] {
  return agents.map(agent => ({
    id: agent.id,
    type: 'agentNode',
    position: NODE_POSITIONS[agent.id] ?? { x: 0, y: 0 },
    data: { agent, fanout: fanouts[agent.id] ?? null },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }))
}

export function buildEdges(agents: AgentSchema[]): Edge[] {
  const ids = new Set(agents.map(a => a.id))
  // Only include edges where both endpoints exist in the loaded agent list
  return PIPELINE_EDGES.filter(e => ids.has(e.source) && ids.has(e.target))
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/canvas/pipelineData.ts
git commit -m "feat(canvas): add pipelineData — derives ReactFlow nodes+edges from AgentSchema[]"
```

---

## Task 5: AgentNode custom React Flow node

**Files:**
- Create: `frontend/src/canvas/AgentNode.tsx`

- [ ] **Step 1: Create `frontend/src/canvas/AgentNode.tsx`**

```typescript
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { AgentNodeData, SceneStatus } from '../types/canvas'
import { StackBadge, stackBorderClass } from '../components/StackBadge'

const STATUS_DOT: Record<SceneStatus, string> = {
  queued:   'bg-muted',
  running:  'bg-[#00d4a4] animate-pulse',
  done:     'bg-[#00d4a4]',
  failed:   'bg-[#d45656]',
  retrying: 'bg-[#c37d0d] animate-pulse',
}

function dominantStatus(fanout: AgentNodeData['fanout']): SceneStatus | 'idle' {
  if (!fanout || fanout.scenes.length === 0) return 'idle'
  if (fanout.scenes.some(s => s.status === 'running'))  return 'running'
  if (fanout.scenes.some(s => s.status === 'retrying')) return 'retrying'
  if (fanout.scenes.some(s => s.status === 'failed'))   return 'failed'
  if (fanout.scenes.every(s => s.status === 'done'))    return 'done'
  return 'queued'
}

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
  const { agent, fanout } = data
  const status = dominantStatus(fanout)
  const dotColor = status === 'idle' ? 'bg-stone/40' : STATUS_DOT[status]
  const sceneCount = fanout?.scenes.length ?? 0
  const doneCount  = fanout?.scenes.filter(s => s.status === 'done').length ?? 0

  return (
    <div
      className={[
        'bg-canvas rounded-lg border border-hairline border-l-4',
        stackBorderClass(agent.stack),
        selected ? 'ring-2 ring-[#00d4a4]/60 shadow-lg' : 'shadow-[rgba(0,0,0,0.06)_0px_1px_3px]',
        'w-[240px] cursor-pointer select-none',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left}  className="!bg-hairline !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-hairline !w-2 !h-2 !border-0" />

      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <StackBadge stack={agent.stack} />
        </div>
        <p className="text-sm font-semibold text-ink leading-snug truncate">{agent.name}</p>
        <p className="text-[11px] text-steel mt-0.5 truncate">{agent.role}</p>
      </div>

      <div className="flex items-center justify-between px-3 pb-2.5 border-t border-hairline/50 pt-2">
        <span className="text-[10px] font-mono text-stone">{agent.id}</span>
        {sceneCount > 0 && (
          <span className="text-[10px] text-steel tabular-nums">{doneCount}/{sceneCount}</span>
        )}
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Verify the StackBadge import path is correct**

`StackBadge` and `stackBorderClass` are exported from `frontend/src/components/StackBadge.tsx` — import path `../components/StackBadge` is correct from `canvas/`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/canvas/AgentNode.tsx
git commit -m "feat(canvas): add AgentNode custom React Flow node with stack border and status dot"
```

---

## Task 6: PipelineCanvas — React Flow canvas

**Files:**
- Create: `frontend/src/canvas/PipelineCanvas.tsx`

- [ ] **Step 1: Create `frontend/src/canvas/PipelineCanvas.tsx`**

```typescript
import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentSchema } from '../types'
import type { AgentNodeData, SceneFanout, PipelineState } from '../types/canvas'
import { AgentNode } from './AgentNode'
import { buildNodes, buildEdges } from './pipelineData'
import { NodePanel } from '../panel/NodePanel'

const NODE_TYPES = { agentNode: AgentNode }

interface Props {
  agents: AgentSchema[]
  fanouts?: Record<string, SceneFanout>
}

const DEFAULT_EDGE_OPTS = {
  type: 'smoothstep',
  style: { stroke: '#d1d5db', strokeWidth: 1.5 },
}

export function PipelineCanvas({ agents, fanouts = {} }: Props) {
  const [nodes, , onNodesChange] = useNodesState<AgentNodeData>(buildNodes(agents, fanouts))
  const [edges, , onEdgesChange] = useEdgesState(buildEdges(agents))

  const [pipeline, setPipeline] = useState<PipelineState>({
    selectedNodeId: null,
    panelTab: 'overview',
  })

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setPipeline(prev => ({
      selectedNodeId: prev.selectedNodeId === node.id ? prev.selectedNodeId : node.id,
      panelTab: 'overview',
    }))
  }, [])

  const onPaneClick = useCallback(() => {
    setPipeline(prev => ({ ...prev, selectedNodeId: null }))
  }, [])

  const selectedAgent = agents.find(a => a.id === pipeline.selectedNodeId) ?? null
  const selectedFanout = pipeline.selectedNodeId ? (fanouts[pipeline.selectedNodeId] ?? null) : null

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTS}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        className="bg-surface"
      >
        <Background color="#e5e7eb" gap={24} />
        <Controls className="!bg-canvas !border-hairline !shadow-sm" />
        <MiniMap
          nodeColor={() => '#e5e7eb'}
          className="!bg-canvas !border-hairline"
        />
      </ReactFlow>

      {selectedAgent && (
        <NodePanel
          agent={selectedAgent}
          fanout={selectedFanout}
          activeTab={pipeline.panelTab}
          onTabChange={tab => setPipeline(prev => ({ ...prev, panelTab: tab }))}
          onClose={() => setPipeline(prev => ({ ...prev, selectedNodeId: null }))}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/canvas/PipelineCanvas.tsx
git commit -m "feat(canvas): add PipelineCanvas — ReactFlow canvas with node click → NodePanel"
```

---

## Task 7: NodePanel — floating overlay with tab router

**Files:**
- Create: `frontend/src/panel/NodePanel.tsx`

- [ ] **Step 1: Create `frontend/src/panel/NodePanel.tsx`**

```typescript
import type { AgentSchema } from '../types'
import type { AgentNodeData, SceneFanout, PipelineState } from '../types/canvas'
import { OverviewTab } from './tabs/OverviewTab'
import { ScenesTab }   from './tabs/ScenesTab'
import { PromptTab }   from './tabs/PromptTab'
import { LogsTab }     from './tabs/LogsTab'
import { IOTab }       from './tabs/IOTab'

type Tab = PipelineState['panelTab']

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'scenes',   label: 'Scenes'   },
  { id: 'prompt',   label: 'Prompt'   },
  { id: 'logs',     label: 'Logs'     },
  { id: 'io',       label: 'I/O'      },
]

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  onClose: () => void
}

export function NodePanel({ agent, fanout, activeTab, onTabChange, onClose }: Props) {
  return (
    <div className="absolute top-4 right-4 z-10 w-[420px] max-h-[calc(100vh-6rem)] flex flex-col bg-canvas border border-hairline rounded-xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-hairline shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-mono text-stone truncate">{agent.id}</p>
          <h2 className="text-base font-semibold text-ink leading-snug truncate">{agent.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="ml-3 shrink-0 text-steel hover:text-ink transition-colors text-lg leading-none mt-0.5"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-hairline shrink-0 px-1 pt-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={[
              'px-4 py-2 text-xs font-medium rounded-t transition-colors',
              activeTab === tab.id
                ? 'text-ink border-b-2 border-[#00d4a4]'
                : 'text-steel hover:text-charcoal',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'overview' && <OverviewTab agent={agent} />}
        {activeTab === 'scenes'   && <ScenesTab   agent={agent} fanout={fanout} />}
        {activeTab === 'prompt'   && <PromptTab   agent={agent} />}
        {activeTab === 'logs'     && <LogsTab     agent={agent} fanout={fanout} />}
        {activeTab === 'io'       && <IOTab        agent={agent} fanout={fanout} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/panel/NodePanel.tsx
git commit -m "feat(panel): add NodePanel floating overlay with 5-tab router"
```

---

## Task 8: Panel tabs — OverviewTab and ScenesTab

**Files:**
- Create: `frontend/src/panel/tabs/OverviewTab.tsx`
- Create: `frontend/src/panel/tabs/ScenesTab.tsx`

- [ ] **Step 1: Create `frontend/src/panel/tabs/OverviewTab.tsx`**

```typescript
import type { AgentSchema } from '../../types'

interface Props { agent: AgentSchema }

export function OverviewTab({ agent }: Props) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-1">Role</p>
        <p className="text-charcoal">{agent.role}</p>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-1">Responsibility</p>
        <p className="text-charcoal leading-relaxed">{agent.responsibility}</p>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Inputs</p>
          <ul className="space-y-1">
            {agent.inputs.map(io => (
              <li key={io.name} className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-xs text-charcoal">{io.name}</span>
                <span className="font-mono text-[10px] text-stone">{io.type}</span>
                {io.required && (
                  <span className="text-[9px] font-semibold uppercase px-1 py-px rounded bg-[#d45656]/15 text-[#d45656]">req</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Outputs</p>
          <ul className="space-y-1">
            {agent.outputs.map(io => (
              <li key={io.name} className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-charcoal">{io.name}</span>
                <span className="font-mono text-[10px] text-stone">{io.type}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {agent.acceptance.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Acceptance Criteria</p>
          <ul className="space-y-1">
            {agent.acceptance.map(a => (
              <li key={a} className="flex items-start gap-2 text-xs text-steel">
                <span className="text-[#00d4a4] mt-px shrink-0">✓</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Config</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-stone">Timeout</dt>       <dd className="text-charcoal font-mono">{agent.timeout_s}s</dd>
          <dt className="text-stone">Retries</dt>       <dd className="text-charcoal font-mono">{agent.retry.max_attempts}</dd>
          <dt className="text-stone">Backoff</dt>       <dd className="text-charcoal font-mono">{agent.retry.backoff}</dd>
          <dt className="text-stone">Cost est.</dt>     <dd className="text-charcoal font-mono">{agent.cost_estimate}</dd>
          <dt className="text-stone">Idempotent</dt>    <dd className="text-charcoal font-mono">{agent.idempotent ? 'yes' : 'no'}</dd>
          <dt className="text-stone">Trigger</dt>       <dd className="text-charcoal font-mono">{agent.trigger}</dd>
        </dl>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/panel/tabs/ScenesTab.tsx`**

```typescript
import { useState } from 'react'
import type { AgentSchema } from '../../types'
import type { SceneFanout, SceneRun, SceneStatus } from '../../types/canvas'
import { api } from '../../api'

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
}

const STATUS_COLOR: Record<SceneStatus, string> = {
  queued:   'bg-muted text-stone',
  running:  'bg-[#00d4a4]/15 text-[#1d8f68]',
  done:     'bg-[#00d4a4]/15 text-[#1d8f68]',
  failed:   'bg-[#d45656]/15 text-[#d45656]',
  retrying: 'bg-[#c37d0d]/15 text-[#c37d0d]',
}

function SceneDetail({ scene, agentId }: { scene: SceneRun; agentId: string }) {
  const [triggering, setTriggering] = useState(false)
  const [lastRunId, setLastRunId] = useState<string | null>(null)

  async function handleReRun() {
    setTriggering(true)
    try {
      const res = await api.triggerRun(agentId, {
        context: { ...scene.inputs, scene_id: scene.scene_id },
        system_prompt: '',
      })
      setLastRunId(res.run_id)
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-stone">Run ID</span>
        <span className="font-mono text-charcoal truncate">{scene.run_id ?? '—'}</span>
        <span className="text-stone">Attempts</span>
        <span className="font-mono text-charcoal">{scene.attempts}</span>
        <span className="text-stone">Duration</span>
        <span className="font-mono text-charcoal">{scene.duration_s != null ? `${scene.duration_s}s` : '—'}</span>
        <span className="text-stone">Cost</span>
        <span className="font-mono text-charcoal">{scene.cost != null ? `$${scene.cost.toFixed(4)}` : '—'}</span>
        <span className="text-stone">Acceptance</span>
        <span className="font-mono text-charcoal">{scene.acceptance_passed == null ? '—' : scene.acceptance_passed ? 'passed' : 'failed'}</span>
      </div>

      {scene.error && (
        <p className="text-[#d45656] bg-[#d45656]/8 rounded px-2 py-1.5">{scene.error}</p>
      )}

      {lastRunId && (
        <p className="text-[#00d4a4] text-[11px]">Re-run triggered: <span className="font-mono">{lastRunId}</span></p>
      )}

      <button
        onClick={handleReRun}
        disabled={triggering}
        className="w-full py-1.5 rounded-full bg-ink text-white text-xs font-medium disabled:opacity-50"
      >
        {triggering ? 'Triggering…' : 'Re-run this scene'}
      </button>
    </div>
  )
}

export function ScenesTab({ agent, fanout }: Props) {
  const scenes = fanout?.scenes ?? []
  const [activeIdx, setActiveIdx] = useState(0)

  if (scenes.length === 0) {
    return <p className="text-sm text-stone text-center py-8">No scenes yet — trigger a run to create the first scene.</p>
  }

  return (
    <div>
      {/* Scene pill tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {scenes.map((s, i) => (
          <button
            key={s.scene_id}
            onClick={() => setActiveIdx(i)}
            className={[
              'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
              activeIdx === i
                ? 'bg-ink text-white'
                : 'bg-surface border border-hairline text-steel hover:text-ink',
            ].join(' ')}
          >
            {s.scene_id.toUpperCase()}
            {' '}
            <span className={`inline-block px-1 py-px rounded text-[9px] font-semibold ${STATUS_COLOR[s.status]}`}>
              {s.status}
            </span>
          </button>
        ))}
      </div>

      {/* Selected scene */}
      {scenes[activeIdx] && (
        <div>
          <p className="text-sm font-medium text-ink">{scenes[activeIdx].scene_label}</p>
          <SceneDetail scene={scenes[activeIdx]} agentId={agent.id} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panel/tabs/OverviewTab.tsx frontend/src/panel/tabs/ScenesTab.tsx
git commit -m "feat(panel): add OverviewTab and ScenesTab with scene re-run"
```

---

## Task 9: Panel tabs — PromptTab, LogsTab, IOTab

**Files:**
- Create: `frontend/src/panel/tabs/PromptTab.tsx`
- Create: `frontend/src/panel/tabs/LogsTab.tsx`
- Create: `frontend/src/panel/tabs/IOTab.tsx`

- [ ] **Step 1: Create `frontend/src/panel/tabs/PromptTab.tsx`**

```typescript
import { useState } from 'react'
import type { AgentSchema } from '../../types'

interface Props { agent: AgentSchema }

// Highlight {{placeholder}} tokens in the prompt text
function HighlightedPrompt({ text }: { text: string }) {
  const parts = text.split(/({{[^}]+}})/)
  return (
    <span>
      {parts.map((part, i) =>
        /^{{.+}}$/.test(part)
          ? <mark key={i} className="bg-[#E0A800]/20 text-[#b88400] rounded px-0.5 not-italic">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </span>
  )
}

const DEFAULT_PROMPT: Record<string, string> = {
  'orch.showrunner':    'You are the showrunner for {{episode_title}}.\n\nBreak down the script into scenes, characters, and assets.\n\nScript:\n{{final_script}}',
  'board.storyboard':  'Generate a storyboard breakdown for scene {{scene_id}} of episode {{episode_title}}.\n\nBreakdown:\n{{breakdown}}',
}

export function PromptTab({ agent }: Props) {
  const initial = DEFAULT_PROMPT[agent.id] ?? `You are ${agent.name}.\n\nContext:\n{{context}}`
  const [prompt, setPrompt] = useState(initial)
  const [editing, setEditing] = useState(false)

  // Extract {{placeholder}} tokens
  const placeholders = [...new Set([...prompt.matchAll(/{{([^}]+)}}/g)].map(m => m[1]))]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel">System Prompt</p>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-steel hover:text-ink transition-colors"
        >
          {editing ? 'Preview' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="w-full h-48 font-mono text-xs text-charcoal bg-surface border border-hairline rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-[#00d4a4]"
        />
      ) : (
        <pre className="font-mono text-xs text-charcoal bg-surface border border-hairline rounded-lg p-3 whitespace-pre-wrap leading-relaxed overflow-auto max-h-48">
          <HighlightedPrompt text={prompt} />
        </pre>
      )}

      {placeholders.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Placeholders</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-stone text-left border-b border-hairline">
                <th className="pb-1 font-medium">Name</th>
                <th className="pb-1 font-medium">Resolved from</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/50">
              {placeholders.map(p => (
                <tr key={p}>
                  <td className="py-1.5 font-mono text-[#b88400]">{`{{${p}}}`}</td>
                  <td className="py-1.5 text-stone">context.{p}</td>
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

- [ ] **Step 2: Create `frontend/src/panel/tabs/LogsTab.tsx`**

```typescript
import { useEffect, useRef, useState } from 'react'
import type { AgentSchema } from '../../types'
import type { SceneFanout } from '../../types/canvas'
import { api } from '../../api'

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
}

export function LogsTab({ agent, fanout }: Props) {
  const scenes = fanout?.scenes ?? []
  const [activeIdx, setActiveIdx] = useState(0)
  const [lines, setLines] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const activeScene = scenes[activeIdx]

  useEffect(() => {
    if (!activeScene?.run_id) {
      setLines(activeScene?.logs ?? [])
      setStreaming(false)
      return
    }

    const runId = activeScene.run_id
    if (activeScene.status === 'done' || activeScene.status === 'failed') {
      setLines(activeScene.logs)
      setStreaming(false)
      return
    }

    // Live stream for running/retrying scenes
    setLines([])
    setStreaming(true)
    const es = api.streamRun(runId)

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string; data: { message?: string } }
        if (event.type === 'log' && event.data.message) {
          setLines(prev => [...prev, event.data.message!])
        }
        if (event.type === 'complete') {
          setStreaming(false)
        }
      } catch { /* ignore parse errors */ }
    })

    return () => {
      es.close()
      setStreaming(false)
    }
  }, [activeScene?.run_id, activeScene?.status])

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines])

  if (scenes.length === 0) {
    return <p className="text-sm text-stone text-center py-8">No scenes to show logs for.</p>
  }

  return (
    <div className="space-y-3">
      {/* Scene selector */}
      <div className="flex flex-wrap gap-1.5">
        {scenes.map((s, i) => (
          <button
            key={s.scene_id}
            onClick={() => setActiveIdx(i)}
            className={[
              'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
              activeIdx === i ? 'bg-ink text-white' : 'bg-surface border border-hairline text-steel hover:text-ink',
            ].join(' ')}
          >
            {s.scene_id.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Log output */}
      <div
        ref={logRef}
        className="h-64 overflow-y-auto bg-[#0d1117] rounded-lg p-3 font-mono text-[11px] text-[#c9d1d9] space-y-0.5"
      >
        {lines.length === 0 ? (
          <span className="text-[#484f58]">{activeScene?.run_id ? 'Waiting for logs…' : 'No run yet.'}</span>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
        {streaming && <div className="text-[#00d4a4] animate-pulse">▌</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/src/panel/tabs/IOTab.tsx`**

```typescript
import type { AgentSchema } from '../../types'
import type { SceneFanout } from '../../types/canvas'
import { useState } from 'react'

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
}

export function IOTab({ agent, fanout }: Props) {
  const scenes = fanout?.scenes ?? []
  const [activeIdx, setActiveIdx] = useState(0)
  const scene = scenes[activeIdx]

  return (
    <div className="space-y-3">
      {scenes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scenes.map((s, i) => (
            <button
              key={s.scene_id}
              onClick={() => setActiveIdx(i)}
              className={[
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                activeIdx === i ? 'bg-ink text-white' : 'bg-surface border border-hairline text-steel hover:text-ink',
              ].join(' ')}
            >
              {s.scene_id.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Raw inputs */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Input</p>
          <pre className="bg-surface border border-hairline rounded-lg p-2.5 text-[10px] font-mono text-charcoal overflow-auto max-h-48 whitespace-pre-wrap">
            {scene
              ? JSON.stringify(scene.inputs, null, 2)
              : JSON.stringify(
                  Object.fromEntries(agent.inputs.map(i => [i.name, `<${i.type}>`])),
                  null, 2
                )
            }
          </pre>
        </div>

        {/* Outputs / artifacts */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Output</p>
          {scene && scene.outputs.length > 0 ? (
            <ul className="space-y-2">
              {scene.outputs.map(o => (
                <li key={o.name} className="bg-surface border border-hairline rounded-lg p-2.5 text-[10px]">
                  <p className="font-mono font-semibold text-charcoal">{o.name}</p>
                  <p className="text-stone font-mono">{o.type}</p>
                  {o.url && (
                    <a href={o.url} target="_blank" rel="noreferrer" className="text-[#3772cf] hover:underline break-all">
                      {o.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="bg-surface border border-hairline rounded-lg p-2.5 text-[10px] font-mono text-stone overflow-auto max-h-48">
              {scene ? 'No outputs yet.' : JSON.stringify(
                Object.fromEntries(agent.outputs.map(o => [o.name, `<${o.type}>`])),
                null, 2
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panel/tabs/PromptTab.tsx frontend/src/panel/tabs/LogsTab.tsx frontend/src/panel/tabs/IOTab.tsx
git commit -m "feat(panel): add PromptTab, LogsTab, IOTab"
```

---

## Task 10: Wire up mock API additions

**Files:**
- Modify: `frontend/src/api/mock.ts`
- Modify: `frontend/src/api/index.ts`

- [ ] **Step 1: Add `listRuns` export to `frontend/src/api/mock.ts`**

Add after the existing `getRuns` function (around line 420):

```typescript
export async function listRuns(agentId?: string): Promise<RunRecord[]> {
  await delay(200)
  if (agentId) return MOCK_RUNS.filter(r => r.agent_id === agentId)
  return [...MOCK_RUNS]
}
```

- [ ] **Step 2: Make `triggerRun` scene-aware in `frontend/src/api/mock.ts`**

Replace the existing `triggerRun` function body — it now stamps `scene_id` from `body.context` into the new run record:

```typescript
export async function triggerRun(
  agentId: string,
  body: RunTriggerRequest,
): Promise<RunTriggerResponse> {
  await delay(400)
  const run_id = `run_${agentId.replace(/\./g, '_')}_${Date.now()}`
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
    context: body.context,
    system_prompt: body.system_prompt,
    scene_id: body.context.scene_id as string | undefined,
  })
  return { run_id }
}
```

- [ ] **Step 3: Expose `listRuns` in `frontend/src/api/index.ts`**

Add `listRuns` to both branches of the `api` object:

```typescript
import { USE_MOCK } from '../config'
import * as live from './client'
import * as mock from './mock'

export const api = USE_MOCK
  ? {
      getAgents:  mock.getAgents,
      triggerRun: mock.triggerRun,
      getRun:     mock.getRun,
      getRuns:    mock.getRuns,
      listRuns:   mock.listRuns,
      getMetrics: mock.getMetrics,
      getHealth:  mock.getHealth,
      streamRun:  mock.streamRun,
    }
  : {
      getAgents:  live.getAgents,
      triggerRun: live.triggerRun,
      getRun:     live.getRun,
      getRuns:    live.getRuns,
      listRuns:   live.getRuns,   // same backend endpoint, reuse getRuns
      getMetrics: live.getMetrics,
      getHealth:  live.getHealth,
      streamRun:  live.streamRun,
    }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/mock.ts frontend/src/api/index.ts
git commit -m "feat(api): add listRuns to mock and facade, make triggerRun scene-aware"
```

---

## Task 11: Replace AgentsView, delete AgentCard, verify build

**Files:**
- Replace: `frontend/src/views/AgentsView.tsx`
- Delete: `frontend/src/views/AgentCard.tsx`

- [ ] **Step 1: Replace `frontend/src/views/AgentsView.tsx`**

```typescript
import { useEffect, useState } from 'react'
import type { AgentSchema } from '../types'
import type { SceneFanout } from '../types/canvas'
import { api } from '../api'
import { PipelineCanvas } from '../canvas/PipelineCanvas'
import { SCENE_FANOUTS } from '../mock/sceneMock'
import { USE_MOCK } from '../config'

export function AgentsView() {
  const [agents, setAgents] = useState<AgentSchema[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getAgents()
      .then(setAgents)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-sm text-stone animate-pulse">Loading pipeline…</span>
      </div>
    )
  }

  if (error) {
    return <p className="text-[#d45656] text-sm p-8">{error}</p>
  }

  const fanouts: Record<string, SceneFanout> = USE_MOCK ? SCENE_FANOUTS : {}

  return (
    <div className="w-full h-full">
      <PipelineCanvas agents={agents} fanouts={fanouts} />
    </div>
  )
}
```

- [ ] **Step 2: Delete `frontend/src/views/AgentCard.tsx`**

```bash
rm frontend/src/views/AgentCard.tsx
```

- [ ] **Step 3: Run the TypeScript build to catch any import errors**

```bash
cd frontend && npm run build
```

Expected: `✓ built in Ns` with no TypeScript errors. Fix any import path issues before committing.

- [ ] **Step 4: Verify AppShell gives the canvas full height**

Open `frontend/src/components/AppShell.tsx`. The main content area must use `h-full` or `flex-1 min-h-0` so the React Flow canvas can fill the viewport. If the content area currently uses `overflow-y-auto` with a fixed `max-w`, wrap the canvas route differently:

The canvas needs its parent to be `h-full`. Check that the `<main>` element in AppShell passes height down. If it uses `p-8 max-w-5xl`, those classes should NOT apply to the canvas route. You may need to pass a `fullBleed` prop or check if the canvas needs to render outside the padded container.

Check the AppShell now:

```bash
cat frontend/src/components/AppShell.tsx
```

If the main area has padding/max-width that would clip the canvas, add a CSS class to remove it for the `/agents` route. The simplest fix is to make AgentsView use negative margins to escape the padding: `className="-m-8 h-[calc(100vh-4rem)]"` on the outer div (adjust to match AppShell padding).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/AgentsView.tsx
git rm frontend/src/views/AgentCard.tsx
git commit -m "feat(canvas): replace AgentsView with PipelineCanvas wrapper, delete AgentCard"
```

---

## Task 12: Final integration check

- [ ] **Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Open http://localhost:5173/agents**

Verify:
- React Flow canvas renders with nodes for all agents
- Edges connect nodes according to the pipeline
- Clicking a node opens NodePanel on the right
- All 5 tabs are clickable and render content
- Overview tab shows role, inputs/outputs, acceptance
- Scenes tab shows 5 scene pills for `exec.animation` (with mixed statuses)
- Re-run button in Scenes tab calls `api.triggerRun` without throwing
- Logs tab shows static log lines for done scenes
- I/O tab shows input/output JSON
- Clicking the canvas background closes the panel
- Pan and zoom work
- MiniMap and Controls are visible

- [ ] **Step 3: Check that other routes are untouched**

Visit `/runs`, `/metrics` — verify they still work normally (no regressions from the API facade change).

- [ ] **Step 4: Run the production build one final time**

```bash
cd frontend && npm run build
```

Expected: clean build, no TypeScript errors, no missing imports.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(canvas): Section 1 complete — pipeline canvas, node panel, scene mock data"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ `@xyflow/react` installed (Task 1)
- ✅ `types/canvas.ts` — CanvasNode (AgentNodeData), SceneRun, SceneFanout, PipelineState (Task 1)
- ✅ `mock/sceneMock.ts` — 5 scenes, mixed statuses (Task 2)
- ✅ `mock/pipelineMock.ts` — PIPELINE_RUNS with scene_id (Task 2)
- ✅ `canvas/nodeLayout.ts` (Task 3)
- ✅ `canvas/edgeDefinitions.ts` (Task 3)
- ✅ `canvas/pipelineData.ts` (Task 4)
- ✅ `canvas/AgentNode.tsx` (Task 5)
- ✅ `canvas/PipelineCanvas.tsx` (Task 6)
- ✅ `panel/NodePanel.tsx` (Task 7)
- ✅ `panel/tabs/OverviewTab.tsx` (Task 8)
- ✅ `panel/tabs/ScenesTab.tsx` (Task 8)
- ✅ `panel/tabs/PromptTab.tsx` (Task 9)
- ✅ `panel/tabs/LogsTab.tsx` (Task 9)
- ✅ `panel/tabs/IOTab.tsx` (Task 9)
- ✅ `types.ts` — scene_id added (Task 1)
- ✅ `api/mock.ts` — listRuns + scene-aware triggerRun (Task 10)
- ✅ `api/index.ts` — listRuns in facade (Task 10)
- ✅ `views/AgentsView.tsx` replaced (Task 11)
- ✅ `views/AgentCard.tsx` deleted (Task 11)
- ✅ AppShell height check for canvas (Task 11)

**Type consistency check:**
- `AgentNodeData` defined in `types/canvas.ts`, imported by `AgentNode.tsx` and `pipelineData.ts` ✅
- `SceneFanout` used in `NodePanel`, `ScenesTab`, `LogsTab`, `IOTab` — all import from `../../types/canvas` ✅
- `PipelineState['panelTab']` used as `Tab` alias in NodePanel ✅
- `api.listRuns` exposed in facade — both mock and live branches ✅
- `SCENE_FANOUTS` from `sceneMock.ts` used in new `AgentsView.tsx` ✅
