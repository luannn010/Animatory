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
  url: string
  size_bytes?: number
}

export interface RunRecord {
  run_id: string
  agent_id: string
  status: RunStatus
  attempts: number
  duration_s: number | null
  cost: number | null
  gpu_seconds: number | null
  acceptance_passed: boolean | null
  outputs: OutputArtifact[]
  error: string | null
  created_at: string
  logs: string[]
  scene_id?: string
  context: Record<string, unknown>
  system_prompt: string
}

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
  pass_rate: number
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
