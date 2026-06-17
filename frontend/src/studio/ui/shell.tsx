// Shared shell helpers for the pre-production track pages: the readiness header
// strip atop each dashboard, section labels, and a back link. Ported from the
// design system's shell.jsx.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { ProgressBar, type Tone } from './primitives'

export function TrackHeaderStrip({
  title, sub, done, total, unit = 'locked', tone = 'active', action,
}: {
  title: string; sub?: string; done: number; total: number; unit?: string; tone?: Tone; action?: ReactNode
}) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 text-sm text-stone">{sub}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="text-xs text-stone whitespace-nowrap">
          <span className="font-mono font-semibold text-ink">{done}</span>
          <span className="text-stone"> of </span>
          <span className="font-mono">{total}</span> {unit}
        </div>
        <div className="w-[220px]"><ProgressBar value={done} max={total} tone={pct === 100 ? 'ready' : tone} thin /></div>
        {action}
      </div>
    </div>
  )
}

export function SectionLabel({
  icon, count, action, children,
}: { icon?: IconName; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {icon && <Icon name={icon} size={16} className="text-steel" />}
        <h2 className="text-sm font-semibold text-ink">{children}</h2>
        {count != null && (
          <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-medium text-stone">{count}</span>
        )}
      </div>
      {action}
    </div>
  )
}

export function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm text-steel hover:text-[#3772cf] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded-md"
    >
      <Icon name="chevron-right" size={15} className="rotate-180" />
      {children}
    </button>
  )
}
