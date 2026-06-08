// frontend/src/spellcheck/DocView.tsx
import type { Finding } from './types'

// Restrained, token-based emphasis: ONE accent for every highlight; the TYPE is
// conveyed by underline weight, not three competing colors (ui-taste rule 1).
const UNDERLINE: Record<Finding['type'], string> = {
  spelling: 'underline decoration-[#3772cf] decoration-solid',
  grammar: 'underline decoration-[#3772cf] decoration-dotted',
  naming: 'underline decoration-[#3772cf] decoration-double',
}

interface Props {
  text: string
  findings: Finding[]
  onApply: (id: string) => void
}

/** Render the document, wrapping each pending finding's span in a clickable
 *  highlight. Spans are non-overlapping (the reducer drops overlaps). */
export function DocView({ text, findings, onApply }: Props) {
  const pending = findings
    .filter(f => f.status === 'pending')
    .sort((a, b) => a.char_start - b.char_start)

  const nodes: React.ReactNode[] = []
  let cursor = 0
  pending.forEach((f, i) => {
    if (f.char_start < cursor) return // safety: skip any residual overlap
    if (f.char_start > cursor) nodes.push(<span key={`t${i}`}>{text.slice(cursor, f.char_start)}</span>)
    nodes.push(
      <button
        key={f.id}
        onClick={() => onApply(f.id)}
        title={`${f.original} → ${f.suggestion}`}
        className={`bg-[#3772cf]/10 hover:bg-[#3772cf]/20 rounded-xs px-0.5 cursor-pointer ${UNDERLINE[f.type]} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors`}
      >
        {text.slice(f.char_start, f.char_end)}
      </button>,
    )
    cursor = f.char_end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)

  return (
    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-steel">
      {nodes}
    </pre>
  )
}
