// frontend/src/components/refine/EditableSceneCard.tsx
import { useState } from 'react'
import type { PipelineScene, ScenePatch } from '../../api/pipeline'
import { EMOTIONS, INTENSITIES } from '../../api/pipeline'
import { SceneReadView } from './SceneReadView'

const SHOT_TYPES = ['wide', 'medium', 'close-up', 'insert', 'POV']

interface Props {
  scene: PipelineScene
  isEditing: boolean
  proposal?: ScenePatch
  onEdit: () => void
  onCancel: () => void
  onSaveLocal: (next: PipelineScene) => void
  onAcceptProposal: () => void
  onRejectProposal: () => void
  onReparse: () => void
  reparsing: boolean
}

export function EditableSceneCard({
  scene, isEditing, proposal, onEdit, onCancel, onSaveLocal, onAcceptProposal, onRejectProposal,
  onReparse, reparsing,
}: Props) {
  if (isEditing) return <EditForm scene={scene} onCancel={onCancel} onSave={onSaveLocal} />

  return (
    <div className="bg-canvas border border-hairline rounded-md p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-stone">
          {sceneLabel(scene.scene_id)}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {scene.shot_type && (
            <span className="font-mono text-[11px] uppercase tracking-wide text-[#3772cf]">
              {scene.shot_type}
            </span>
          )}
          <button
            onClick={onReparse}
            disabled={reparsing}
            className="text-[11px] text-steel hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          >
            {reparsing ? 'Re-parsing…' : 'Re-parse'}
          </button>
          <button
            onClick={onEdit}
            className="text-[11px] text-steel hover:text-ink transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          >
            Edit
          </button>
        </div>
      </div>

      <SceneReadView scene={scene} />

      {proposal && (
        <div className="mt-3 rounded-md border border-[#3772cf]/40 bg-[#3772cf]/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#3772cf] mb-1.5">Suggested</div>
          <SceneReadView scene={{ ...scene, ...proposal.changes }} />
          {proposal.rationale && <p className="text-[11px] text-steel mt-2 mb-2">{proposal.rationale}</p>}
          <div className="flex gap-2">
            <button
              onClick={onAcceptProposal}
              className="px-2.5 py-1 rounded-md bg-[#3772cf] text-white text-[11px] font-medium hover:bg-[#2c5cab] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
            >
              Accept
            </button>
            <button
              onClick={onRejectProposal}
              className="px-2.5 py-1 rounded-md border border-hairline text-steel text-[11px] hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditForm({ scene, onCancel, onSave }: {
  scene: PipelineScene; onCancel: () => void; onSave: (s: PipelineScene) => void
}) {
  const [draft, setDraft] = useState<PipelineScene>(scene)
  const set = (patch: Partial<PipelineScene>) => setDraft(d => ({ ...d, ...patch }))
  const field = 'w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

  return (
    <div className="bg-canvas border border-[#3772cf]/40 rounded-md p-4 space-y-2.5">
      <div className="font-mono text-[11px] uppercase tracking-wide text-stone">{sceneLabel(scene.scene_id)}</div>
      <textarea className={field} rows={2} value={draft.action} onChange={e => set({ action: e.target.value })} placeholder="Action" />
      <div className="grid grid-cols-2 gap-2">
        <input className={field} value={draft.location} onChange={e => set({ location: e.target.value })} placeholder="Location" />
        <select className={field} value={draft.shot_type} onChange={e => set({ shot_type: e.target.value })}>
          {SHOT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className={field} value={draft.characters.join(', ')} onChange={e => set({ characters: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Characters (comma-separated)" />
        <input className={field} value={draft.mood} onChange={e => set({ mood: e.target.value })} placeholder="Mood" />
      </div>

      <div className="space-y-1.5">
        {draft.dialogue.map((d, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-1.5">
              <input className={field + ' w-1/3'} value={d.character} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], character: e.target.value }; set({ dialogue: dl })
              }} placeholder="Character" />
              <input className={field} value={d.line} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], line: e.target.value }; set({ dialogue: dl })
              }} placeholder="Line" />
              <button
                onClick={() => set({ dialogue: draft.dialogue.filter((_, j) => j !== i) })}
                className="text-stone hover:text-brand-error px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded transition-colors"
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1.5 pl-[calc(33%+0.375rem)]">
              <select className={field + ' w-1/2'} value={d.emotion ?? ''} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], emotion: e.target.value || null }; set({ dialogue: dl })
              }}>
                <option value="">emotion…</option>
                {EMOTIONS.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
              <select className={field + ' w-1/2'} value={d.intensity ?? ''} onChange={e => {
                const dl = [...draft.dialogue]; dl[i] = { ...dl[i], intensity: e.target.value || null }; set({ dialogue: dl })
              }}>
                <option value="">intensity…</option>
                {INTENSITIES.map(it => <option key={it} value={it}>{it}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button
          onClick={() => set({ dialogue: [...draft.dialogue, { character: '', line: '' }] })}
          className="text-[11px] text-steel hover:text-ink transition-colors"
        >
          + Add dialogue line
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-stone">Narration</div>
        {(draft.narration ?? []).map((n, i) => (
          <div key={i} className="flex gap-1.5">
            <input className={field} value={n} onChange={e => {
              const nr = [...(draft.narration ?? [])]; nr[i] = e.target.value; set({ narration: nr })
            }} placeholder="Narration line" />
            <button
              onClick={() => set({ narration: (draft.narration ?? []).filter((_, j) => j !== i) })}
              className="text-stone hover:text-brand-error px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded transition-colors"
              aria-label="Remove narration line"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => set({ narration: [...(draft.narration ?? []), ''] })}
          className="text-[11px] text-steel hover:text-ink transition-colors"
        >
          + Add narration line
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(draft)}
          className="px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border border-hairline text-steel text-xs hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function sceneLabel(sceneId: string): string {
  const m = sceneId.match(/_S(\d+)$/)
  return m ? `Scene ${m[1]}` : sceneId
}
