// frontend/src/components/refine/SceneFocusPanel.tsx
import { useEffect, useRef } from 'react'
import type { PipelineScene, ScenePatch, SceneSource } from '../../api/pipeline'
import { SceneReadView } from './SceneReadView'

interface Props {
  scene: PipelineScene
  proposal?: ScenePatch
  source: { loading: boolean; data: SceneSource | null; error: string }
  chapterText: string
  onClose: () => void
  onEdit: () => void
  onAcceptProposal: () => void
  onRejectProposal: () => void
  children: React.ReactNode   // the relocated RefineChat
}

function sceneLabel(sceneId: string): string {
  const m = sceneId.match(/_S(\d+)$/)
  return m ? `Scene ${m[1]}` : sceneId
}

export function SceneFocusPanel({
  scene, proposal, source, chapterText, onClose, onEdit,
  onAcceptProposal, onRejectProposal, children,
}: Props) {
  const firstMatchRef = useRef<HTMLDivElement | null>(null)

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Auto-scroll the source to the first matched line once it loads.
  useEffect(() => {
    if (source.data?.found) firstMatchRef.current?.scrollIntoView({ block: 'center' })
  }, [source.data])

  const matched = new Set(source.data?.match_lines ?? [])
  const lines = chapterText.split('\n')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={sceneLabel(scene.scene_id)}
        className="relative z-10 flex flex-col w-full max-w-5xl max-h-[85vh] rounded-lg border border-hairline bg-canvas p-5 overflow-hidden">

        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute top-3 right-3 z-10 text-stone hover:text-ink rounded-md px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">
          ×
        </button>

        {/* Two-column body: bounded to the dialog height so each column scrolls
            internally instead of the chapter text overflowing the whole screen. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] gap-4 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">

        {/* Left column: scene + source */}
        <div className="min-h-0 lg:overflow-y-auto pr-1 space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-stone">{sceneLabel(scene.scene_id)}</span>
              <button onClick={onEdit}
                className="text-[11px] text-steel hover:text-ink transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">
                Edit
              </button>
            </div>
            <SceneReadView scene={scene} />
            {proposal && (
              <div className="mt-3 rounded-md border border-[#3772cf]/40 bg-[#3772cf]/5 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#3772cf] mb-1.5">Suggested</div>
                <SceneReadView scene={{ ...scene, ...proposal.changes }} />
                {proposal.rationale && <p className="text-[11px] text-steel mt-2 mb-2">{proposal.rationale}</p>}
                <div className="flex gap-2 mt-2">
                  <button onClick={onAcceptProposal}
                    className="px-2.5 py-1 rounded-md bg-[#3772cf] text-white text-[11px] font-medium hover:bg-[#2c5cab] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">Accept</button>
                  <button onClick={onRejectProposal}
                    className="px-2.5 py-1 rounded-md border border-hairline text-steel text-[11px] hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors">Reject</button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-hairline pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-stone mb-1.5">Source text</div>
            {source.loading ? (
              <div className="space-y-1.5 animate-pulse" aria-hidden="true">
                <div className="h-3 w-full rounded-xs bg-hairline" />
                <div className="h-3 w-5/6 rounded-xs bg-hairline" />
                <div className="h-3 w-4/6 rounded-xs bg-hairline" />
              </div>
            ) : source.error ? (
              <p className="text-xs text-brand-error">{source.error}</p>
            ) : (
              <>
                {source.data && !source.data.found && (
                  <p className="text-[11px] text-stone mb-1.5">Couldn't locate this scene in the source — showing the full chapter.</p>
                )}
                <pre className="text-xs text-steel font-mono whitespace-pre-wrap leading-relaxed">
                  {lines.map((ln, i) => {
                    const hit = matched.has(i)
                    return (
                      <div key={i} ref={hit && i === source.data?.line_start ? firstMatchRef : undefined}
                        className={hit ? 'border-l-2 border-[#3772cf] bg-[#3772cf]/5 pl-2 -ml-0.5 text-ink' : 'pl-2'}>
                        {ln || ' '}
                      </div>
                    )
                  })}
                </pre>
              </>
            )}
          </div>
        </div>

        {/* Right column: the relocated chat */}
        <div className="min-h-0 lg:overflow-hidden h-[60vh] lg:h-auto">
          {children}
        </div>

        </div>
      </div>
    </div>
  )
}
