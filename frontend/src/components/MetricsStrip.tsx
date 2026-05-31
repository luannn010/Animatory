import type { MetricsSnapshot } from '../types'

interface Props { metrics: MetricsSnapshot }

export function MetricsStrip({ metrics }: Props) {
  return (
    <div className="flex items-center divide-x divide-hairline border border-hairline rounded-lg bg-canvas overflow-hidden text-sm">
      <Metric label="Total Cost"   value={`$${metrics.total_cost.toFixed(3)}`} />
      <Metric label="GPU Seconds"  value={`${metrics.total_gpu_seconds.toFixed(0)}s`} />
      <Metric label="Avg Attempts" value={metrics.avg_attempts.toFixed(1)} />
      <Metric
        label="Pass Rate"
        value={`${(metrics.pass_rate * 100).toFixed(0)}%`}
        valueClass={metrics.pass_rate >= 0.8 ? 'text-[#00b48a]' : 'text-[#d45656]'}
      />
      <Metric label="Total Runs"   value={String(metrics.total_runs)} />
    </div>
  )
}

function Metric({ label, value, valueClass = 'text-ink' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-3 min-w-[80px]">
      <span className={`font-semibold tabular-nums ${valueClass}`}>{value}</span>
      <span className="text-xs text-stone mt-0.5">{label}</span>
    </div>
  )
}
