import type { RunStatus } from '../types'

const STYLES: Record<RunStatus, string> = {
  queued:   'bg-surface text-steel border-hairline',
  running:  'bg-[#00d4a4]/10 text-[#00b48a] border-[#00d4a4]/30',
  retrying: 'bg-[#c37d0d]/10 text-[#c37d0d] border-[#c37d0d]/30',
  done:     'bg-[#00d4a4]/10 text-[#00b48a] border-[#00d4a4]/30',
  failed:   'bg-[#d45656]/10 text-[#d45656] border-[#d45656]/30',
}

const DOT: Record<RunStatus, string> = {
  queued:   'bg-stone',
  running:  'bg-[#00d4a4] animate-pulse',
  retrying: 'bg-[#c37d0d] animate-pulse',
  done:     'bg-[#00d4a4]',
  failed:   'bg-[#d45656]',
}

interface Props { status: RunStatus }

export function StatusBadge({ status }: Props) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${STYLES[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[status]}`} />
      {status}
    </span>
  )
}
