import { useMemo } from 'react'
import type { MetricsSnapshot, RunStatus, AgentStack } from '../types'
import { MetricsStrip } from '../components/MetricsStrip'
import { MOCK_RUNS, MOCK_AGENTS } from '../api/mock'
import { USE_MOCK } from '../config'

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

  const stackMap = Object.fromEntries(MOCK_AGENTS.map(a => [a.id, a.stack]))
  const runs_by_stack = runs.reduce((acc, r) => {
    const stack = stackMap[r.agent_id] as AgentStack | undefined
    if (stack) acc[stack] = (acc[stack] ?? 0) + 1
    return acc
  }, {} as Partial<Record<AgentStack, number>>)

  return { total_runs, total_cost, total_gpu_seconds, avg_attempts, pass_rate, runs_by_status, runs_by_stack }
}

const STATUS_ORDER: RunStatus[] = ['done', 'failed', 'running', 'retrying', 'queued']
const STATUS_COLOR: Record<RunStatus, string> = {
  done:     'bg-[#00d4a4]',
  failed:   'bg-[#d45656]',
  running:  'bg-[#00d4a4]/50',
  retrying: 'bg-[#c37d0d]',
  queued:   'bg-muted',
}

export function MetricsView() {
  const metrics = useMemo(computeMetrics, [])

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
