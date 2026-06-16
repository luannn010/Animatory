import type { Phase } from '../types'
import { PHASE_META } from '../phases'

const STYLES: Record<Phase, string> = {
  script:     'bg-[#7c3aed]/10 text-[#7c3aed] border-[#7c3aed]/30',
  pre:        'bg-[#c37d0d]/10 text-[#c37d0d] border-[#c37d0d]/30',
  production: 'bg-[#3772cf]/10 text-[#3772cf] border-[#3772cf]/30',
  post:       'bg-[#00b48a]/10 text-[#00b48a] border-[#00d4a4]/40',
}

interface Props { phase: Phase; label?: string }

const FALLBACK = 'bg-surface text-stone border-hairline'

export function PhaseBadge({ phase, label }: Props) {
  // Defensive: an unknown/missing phase (e.g. a backend returning a legacy phase
  // vocabulary) must never crash the whole app — fall back to a neutral badge.
  const style = STYLES[phase] ?? FALLBACK
  const text = label ?? PHASE_META[phase]?.short ?? (phase ? String(phase) : '—')
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${style}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}
