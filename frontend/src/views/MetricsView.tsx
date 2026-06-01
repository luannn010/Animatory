import { useEffect, useState } from 'react'
import type { MetricsSnapshot, RunStatus } from '../types'
import { MetricsStrip } from '../components/MetricsStrip'
import { api } from '../api'

const EMPTY_METRICS: MetricsSnapshot = {
  total_runs: 0, total_cost: 0, total_gpu_seconds: 0,
  avg_attempts: 0, pass_rate: 0, runs_by_status: {} as MetricsSnapshot['runs_by_status'],
  runs_by_stack: {},
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
  const [metrics, setMetrics] = useState<MetricsSnapshot>(EMPTY_METRICS)

  useEffect(() => {
    api.getMetrics().then(data => setMetrics(data))
  }, [])

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
