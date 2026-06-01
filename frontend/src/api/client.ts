import { API_BASE_URL } from '../config'
import type {
  AgentSchema,
  RunRecord,
  RunTriggerRequest,
  RunTriggerResponse,
  HealthResponse,
  RunEvent,
  OutputArtifact,
} from '../types'
import type { MockEventSource } from './mock'

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

export async function getRun(runId: string): Promise<RunRecord> {
  const raw = await apiFetch<Record<string, unknown>>(`/runs/${runId}`)
  // Normalize backend field differences
  return {
    ...raw,
    created_at: (raw.started_at ?? raw.created_at ?? new Date().toISOString()) as string,
    outputs: ((raw.outputs ?? []) as Array<Record<string, unknown>>).map(o => ({
      ...o,
      url: (o.artifact_url ?? o.url ?? '') as string,
    })),
    context: (raw.context ?? {}) as Record<string, unknown>,
    system_prompt: (raw.system_prompt ?? '') as string,
    logs: (raw.logs ?? []) as string[],
  } as RunRecord
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}

export function getRuns(agentId?: string, limit = 25): Promise<RunRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (agentId) params.set('agent_id', agentId)
  return apiFetch<RunRecord[]>(`/runs?${params}`)
}

export async function getMetrics(agentId?: string): Promise<import('../types').MetricsSnapshot> {
  const params = agentId ? `?agent_id=${agentId}` : ''
  const raw = await apiFetch<{
    total_runs: number; done: number; failed: number;
    avg_duration_s: number | null; total_cost: number | null;
    acceptance_pass_rate: number | null;
  }>(`/metrics${params}`)
  return {
    total_runs: raw.total_runs,
    total_cost: raw.total_cost ?? 0,
    total_gpu_seconds: 0,
    avg_attempts: 0,
    pass_rate: raw.acceptance_pass_rate ?? 0,
    runs_by_status: {
      done: raw.done,
      failed: raw.failed,
      running: 0,
      retrying: 0,
      queued: 0,
    },
    runs_by_stack: {},
  }
}

// The backend emits named SSE events: `status`, `log`, `done`.
// This wrapper normalizes them into the same `message` event interface
// that mock.ts uses, so RunMonitor doesn't need to know the difference.
export function streamRun(runId: string): MockEventSource {
  const es = new EventSource(`${API_BASE_URL}/runs/${runId}/stream`)
  const et = new EventTarget()

  function emit(event: RunEvent) {
    et.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
  }

  function now() { return new Date().toISOString() }

  es.addEventListener('status', (e: Event) => {
    const raw = JSON.parse((e as MessageEvent).data) as { status: string; attempts: number }
    emit({ type: 'status', run_id: runId, timestamp: now(), data: { status: raw.status as RunEvent['data']['status'], attempts: raw.attempts } })
  })

  es.addEventListener('log', (e: Event) => {
    const raw = JSON.parse((e as MessageEvent).data) as { message: string }
    emit({ type: 'log', run_id: runId, timestamp: now(), data: { message: raw.message } })
  })

  es.addEventListener('done', (e: Event) => {
    // Backend sends full RunRecord on the `done` event
    const rec = JSON.parse((e as MessageEvent).data) as {
      status: string; attempts: number; duration_s: number | null;
      cost: number | null; gpu_seconds: number | null;
      acceptance_passed: boolean | null; outputs: Array<{ name: string; type: string; artifact_url?: string; url?: string }>;
      error: string | null
    }
    const outputs: OutputArtifact[] = (rec.outputs ?? []).map(o => ({
      name: o.name,
      type: o.type as OutputArtifact['type'],
      url: o.artifact_url ?? o.url ?? '',
    }))
    emit({
      type: 'complete', run_id: runId, timestamp: now(),
      data: {
        status: rec.status as RunEvent['data']['status'],
        attempts: rec.attempts,
        duration_s: rec.duration_s ?? undefined,
        cost: rec.cost ?? undefined,
        gpu_seconds: rec.gpu_seconds ?? undefined,
        acceptance_passed: rec.acceptance_passed ?? undefined,
        outputs,
        error: rec.error ?? undefined,
      },
    })
  })

  return {
    addEventListener: (type, handler) => et.addEventListener(type, handler as EventListener),
    removeEventListener: (type, handler) => et.removeEventListener(type, handler as EventListener),
    close: () => es.close(),
  }
}
