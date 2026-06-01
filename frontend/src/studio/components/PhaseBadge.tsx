import type { Phase } from '../types'
import { PHASE_META } from '../phases'

const STYLES: Record<Phase, string> = {
  parse:  'bg-[#7c3aed]/10 text-[#7c3aed] border-[#7c3aed]/30',
  pre:    'bg-[#c37d0d]/10 text-[#c37d0d] border-[#c37d0d]/30',
  vendor: 'bg-[#3772cf]/10 text-[#3772cf] border-[#3772cf]/30',
  post:   'bg-[#00b48a]/10 text-[#00b48a] border-[#00d4a4]/40',
}

interface Props { phase: Phase; label?: string }

export function PhaseBadge({ phase, label }: Props) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${STYLES[phase]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label ?? PHASE_META[phase].short}
    </span>
  )
}
