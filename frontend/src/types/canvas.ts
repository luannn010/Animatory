import type { AgentSchema } from '../types'

export type SceneStatus = 'queued' | 'running' | 'done' | 'failed' | 'retrying'

export interface SceneRun {
  scene_id: string
  scene_label: string
  run_id: string | null
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

export interface AgentNodeData extends Record<string, unknown> {
  agent: AgentSchema
  fanout: SceneFanout | null
}
