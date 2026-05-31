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
  body: RunTriggerRequest,
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

export function streamRun(runId: string): EventSource {
  return new EventSource(`${API_BASE_URL}/runs/${runId}/stream`)
}
