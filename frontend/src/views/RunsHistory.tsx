import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RunRecord } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { MOCK_RUNS } from '../api/mock'
import { USE_MOCK } from '../config'

export function RunsHistory() {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (USE_MOCK) {
      setTimeout(() => { setRuns([...MOCK_RUNS]); setLoading(false) }, 200)
    } else {
      setRuns([])
      setLoading(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 max-w-4xl">
        {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-hairline rounded-md" />)}
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Run History</h1>
        <p className="text-sm text-steel mt-1">{runs.length} runs</p>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-16 text-stone text-sm">
          No runs yet. Trigger one from the Agents view.
        </div>
      ) : (
        <div className="bg-canvas rounded-lg border border-hairline overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface">
                {['Run ID', 'Agent', 'Status', 'Duration', 'Cost', 'Started'].map((h, i) => (
                  <th key={h} className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-steel ${i >= 3 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {runs.map(run => (
                <tr key={run.run_id}>
                  <td className="px-5 py-3">
                    <Link to={`/runs/${run.run_id}`} className="font-mono text-xs text-[#3772cf] hover:underline underline-offset-2">
                      {run.run_id}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-charcoal">{run.agent_id}</td>
                  <td className="px-5 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-5 py-3 text-right text-xs text-steel tabular-nums">
                    {run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-steel tabular-nums">
                    {run.cost != null ? `$${run.cost.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs text-stone">
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
