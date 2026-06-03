// frontend/src/components/refine/RawTextEditor.tsx
import { useState } from 'react'
import type { TextCorrection } from '../../api/pipeline'
import { correctionMatches } from './corrections'

interface Props {
  text: string
  edited: boolean
  dirty: boolean
  saving: boolean
  parsed: boolean
  parsing: boolean
  parseProgress: { done: number; total: number } | null
  corrections: TextCorrection[]
  onChange: (next: string) => void
  onAcceptCorrection: (c: TextCorrection) => void
  onRejectCorrection: (c: TextCorrection) => void
  onSave: () => void
  onReset: () => void
  onParse: () => void
}

export function RawTextEditor(props: Props) {
  const {
    text, edited, dirty, saving, parsed, parsing, parseProgress,
    corrections, onAcceptCorrection, onRejectCorrection, onChange, onSave, onReset, onParse,
  } = props
  const [editing, setEditing] = useState(false)

  const pct = parseProgress && parseProgress.total > 0
    ? Math.round((parseProgress.done / parseProgress.total) * 100) : 0

  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink">
          Raw text{edited && <span className="ml-2 text-[11px] font-normal text-[#3772cf]">&#9998; edited</span>}
        </h2>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-steel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded transition-colors"
        >
          {editing ? 'Done editing' : 'Edit text'}
        </button>
      </div>

      <div className="rounded-lg border border-hairline bg-canvas">
        {editing ? (
          <textarea
            value={text}
            onChange={e => onChange(e.target.value)}
            className="w-full max-h-80 min-h-[12rem] resize-y p-4 text-xs leading-relaxed text-steel bg-canvas font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded-lg"
          />
        ) : (
          <pre className="max-h-80 overflow-y-auto p-4 text-xs leading-relaxed text-steel whitespace-pre-wrap font-mono">
            {text}
          </pre>
        )}
      </div>

      {corrections.length > 0 && (
        <div className="mt-3 space-y-2">
          {corrections.map((c, i) => {
            const stale = !correctionMatches(text, c)
            return (
              <div key={i} className="flex items-start gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs">
                <div className="flex-1">
                  <span className="line-through text-stone">{c.find}</span>
                  <span className="mx-1.5 text-stone">→</span>
                  <span className="text-ink font-medium">{c.replace}</span>
                  {c.all_occurrences && <span className="ml-2 text-[11px] text-[#3772cf]">all</span>}
                  {c.rationale && <div className="text-[11px] text-steel mt-0.5">{c.rationale}</div>}
                  {stale && <div className="text-[11px] text-stone mt-0.5">no longer applies</div>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    disabled={stale}
                    onClick={() => onAcceptCorrection(c)}
                    className="px-2 py-0.5 rounded-md bg-[#3772cf] text-white text-[11px] disabled:opacity-40 hover:bg-[#2c5cab] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRejectCorrection(c)}
                    className="px-2 py-0.5 rounded-md border border-hairline text-steel text-[11px] hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-2.5 mt-3">
        {edited && (
          <button
            onClick={onReset}
            disabled={saving || parsing}
            className="text-xs text-steel hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded transition-colors"
          >
            Reset text
          </button>
        )}
        {dirty && (
          <button
            onClick={onSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-md border border-hairline text-steel text-xs hover:bg-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
          >
            {saving ? 'Saving…' : 'Save text ●'}
          </button>
        )}
        <button
          onClick={onParse}
          disabled={parsing}
          className="px-4 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
        >
          {parsing ? `Parsing… ${pct}%` : parsed ? 'Re-parse' : 'Parse this chapter'}
        </button>
      </div>
    </section>
  )
}
