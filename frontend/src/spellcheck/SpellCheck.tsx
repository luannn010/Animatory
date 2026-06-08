// frontend/src/spellcheck/SpellCheck.tsx
import { useEffect, useState } from 'react'
import type { Finding } from './types'
import { useSpellCheckWS } from './useSpellCheckWS'
import { applyOne, applyAll } from './offsets'
import { DocView } from './DocView'
import { FindingCard } from './FindingCard'

interface Props {
  episodeId: string
  chunkId: string
  initialText: string
  /** Commit the corrected text back to the editor and close. */
  onApply: (correctedText: string) => void
  onClose: () => void
}

export function SpellCheck({ episodeId, chunkId, initialText, onApply, onClose }: Props) {
  const { state } = useSpellCheckWS(episodeId, chunkId, initialText)
  const [text, setText] = useState(initialText)
  const [findings, setFindings] = useState<Finding[]>([])

  // Sync streamed findings into local working state (offsets are global already).
  useEffect(() => { setFindings(state.findings) }, [state.findings])

  // Esc closes; lock body scroll while open (mirrors SceneFocusPanel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const remaining = findings.filter(f => f.status === 'pending').length

  function apply(id: string, override?: string) {
    const r = applyOne(text, findings, id, override)
    setText(r.text); setFindings(r.findings)
  }
  function reject(id: string) {
    setFindings(fs => fs.map(f => (f.id === id ? { ...f, status: 'stale' } : f)))
  }
  function acceptAll() {
    const r = applyAll(text, findings)
    setText(r.text); setFindings(r.findings)
  }
  function reset() {
    setText(initialText)
    setFindings(state.findings.map(f => ({ ...f, status: 'pending' as const })))
  }
  function copy() { void navigator.clipboard?.writeText(text) }

  const progress = state.totalChunks > 0 ? `${state.startedChunks}/${state.totalChunks}` : '…'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Spell check"
        className="relative z-10 flex flex-col w-full max-w-6xl max-h-[88vh] rounded-lg border border-hairline bg-canvas p-5 overflow-hidden">

        {/* Header / toolbar */}
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold text-ink">Spell check</h2>
          <span className="text-[11px] text-stone font-mono">
            {state.done ? `${remaining} remaining` : `checking ${progress} · ${remaining} so far`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={acceptAll} disabled={remaining === 0}
              className="px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
              Accept all
            </button>
            <button onClick={reset}
              className="px-3 py-1.5 rounded-md border border-hairline text-steel text-xs hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
              Reset
            </button>
            <button onClick={copy}
              className="px-3 py-1.5 rounded-md border border-hairline text-steel text-xs hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
              Copy text
            </button>
            <button onClick={() => onApply(text)}
              className="px-3 py-1.5 rounded-md border border-[#3772cf] text-[#3772cf] text-xs font-medium hover:bg-[#3772cf]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
              Apply to editor
            </button>
            <button type="button" onClick={onClose} aria-label="Close"
              className="text-stone hover:text-ink rounded-md px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
              ×
            </button>
          </div>
        </div>

        {state.fatal && (
          <p className="mb-2 text-[11px] text-brand-error">Couldn’t run spell check: {state.fatal}</p>
        )}
        {state.errors.length > 0 && (
          <p className="mb-2 text-[11px] text-brand-warn">
            {state.errors.length} segment(s) failed and were skipped.
          </p>
        )}

        {/* Body: document left, findings right */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
          <div className="min-h-0 overflow-y-auto rounded-md border border-hairline bg-surface-soft p-3">
            <DocView text={text} findings={findings} onApply={id => apply(id)} />
          </div>
          <div className="min-h-0 overflow-y-auto space-y-2">
            {!state.done && findings.length === 0 && (
              <div className="space-y-2 animate-pulse" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-md border border-hairline bg-canvas" />
                ))}
              </div>
            )}
            {state.done && remaining === 0 && findings.length === 0 && (
              <div className="rounded-md border border-dashed border-hairline bg-canvas p-6 text-center text-sm text-steel">
                No issues found.
              </div>
            )}
            {findings.map(f => (
              <FindingCard key={f.id} finding={f} onApply={apply} onReject={reject} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
