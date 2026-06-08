// frontend/src/spellcheck/FindingCard.tsx
import { useState } from 'react'
import type { Finding } from './types'

const TYPE_LABEL: Record<Finding['type'], string> = {
  spelling: 'spelling', grammar: 'grammar', naming: 'naming',
}

interface Props {
  finding: Finding
  onApply: (id: string, suggestionOverride: string) => void
  onReject: (id: string) => void
}

export function FindingCard({ finding, onApply, onReject }: Props) {
  const [draft, setDraft] = useState(finding.suggestion)
  const applied = finding.status === 'applied'
  const stale = finding.status === 'stale'

  return (
    <div className={`rounded-md border px-3 py-2 text-xs transition-colors ${
      applied ? 'border-hairline bg-surface opacity-60' : 'border-hairline bg-canvas'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block rounded-full border border-hairline px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone">
          {TYPE_LABEL[finding.type]}
        </span>
        <span className="line-through text-stone">{finding.original}</span>
        <span className="text-stone">→</span>
        <span className="text-ink font-medium">{finding.suggestion}</span>
        {applied && <span className="ml-auto text-[11px] text-stone">applied</span>}
        {stale && <span className="ml-auto text-[11px] text-brand-warn">no longer applies</span>}
      </div>
      {finding.reason && <p className="text-[11px] text-steel mb-1.5">{finding.reason}</p>}
      {!applied && (
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={stale}
            aria-label="Edit suggestion"
            className="flex-1 rounded-md border border-hairline bg-canvas px-2 py-1 text-xs text-ink font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] disabled:opacity-50"
          />
          <button
            onClick={() => onApply(finding.id, draft)}
            disabled={stale}
            className="px-2 py-1 rounded-md bg-[#3772cf] text-white text-[11px] hover:bg-[#2c5cab] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
          >
            Replace
          </button>
          <button
            onClick={() => onReject(finding.id)}
            className="px-2 py-1 rounded-md border border-hairline text-steel text-[11px] hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
