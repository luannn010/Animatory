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
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [runId])

  if (loading) return <div className="h-64 animate-pulse bg-hairline rounded-lg max-w-2xl" />
  if (error || !run) return <p className="text-[#d45656] text-sm">{error ?? 'Run not found'}</p>

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-xs text-stone mb-8 font-mono">
        <Link to="/runs" className="text-steel">Runs</Link>
        <span>/</span>
        <span className="text-ink">{run.run_id}</span>
      </div>

      <div className="bg-canvas rounded-lg border border-hairline p-6 mb-4 shadow-[rgba(0,0,0,0.04)_0px_1px_2px_0px]">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-ink font-mono">{run.run_id}</h1>
          <StatusBadge status={run.status} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Agent"    value={run.agent_id} mono />
          <Stat label="Attempts" value={String(run.attempts)} />
          <Stat label="Duration" value={run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : '—'} />
          <Stat label="Cost"     value={run.cost != null ? `$${run.cost.toFixed(4)}` : '—'} />
          {run.gpu_seconds != null && <Stat label="GPU sec" value={`${run.gpu_seconds}s`} />}
          {run.acceptance_passed != null && (
            <Stat label="Acceptance" value={run.acceptance_passed ? 'Passed ✓' : 'Failed ✗'} />
          )}
        </div>
      </div>

      {run.logs.length > 0 && (
        <div className="bg-[#1c1c1e] rounded-lg overflow-hidden mb-4">
          <div className="px-4 py-2 border-b border-[#1f1f1f]">
            <span className="text-xs text-[#b3b3b3] font-mono">logs</span>
          </div>
          <div className="p-4 space-y-1 font-mono text-xs text-white">
            {run.logs.map((line, i) => (
              <div key={i}>
                <span className="text-[#b3b3b3] mr-3 select-none">{String(i + 1).padStart(3, '0')}</span>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {run.error && (
        <div className="bg-[#d45656]/10 border border-[#d45656]/30 rounded-lg px-6 py-4 mb-4">
          <p className="text-sm text-[#d45656] font-mono">{run.error}</p>
        </div>
      )}

      {run.outputs.length > 0 && (
        <div className="bg-canvas rounded-lg border border-hairline p-6 mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-4">Outputs</p>
          <div className="grid grid-cols-2 gap-4">
            {run.outputs.map(out => (
              <div key={out.name} className="rounded-md border border-hairline overflow-hidden">
                {out.type === 'image' && <img src={out.url} alt={out.name} className="w-full" />}
                <p className="px-3 py-2 text-xs font-mono text-stone truncate">{out.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(run.status === 'running' || run.status === 'queued' || run.status === 'retrying') && (
        <Link
          to={`/runs/${run.run_id}/monitor`}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#00d4a4] text-ink text-sm font-medium"
        >
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
      <p className={`text-sm font-medium text-ink mt-1 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
