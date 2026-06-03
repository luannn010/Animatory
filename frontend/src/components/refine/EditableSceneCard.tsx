// frontend/src/components/refine/EditableSceneCard.tsx
import { useState } from 'react'
import type { PipelineScene, ScenePatch } from '../../api/pipeline'

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
}

export function EditableSceneCard({
  scene, isEditing, proposal, onEdit, onCancel, onSaveLocal, onAcceptProposal, onRejectProposal,
}: Props) {
  if (isEditing) return <EditForm scene={scene} onCancel={onCancel} onSave={onSaveLocal} />

  const tags = [scene.location, scene.characters.join(', '), scene.mood].filter(Boolean)

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
            onClick={onEdit}
            className="text-[11px] text-steel hover:text-ink transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      {scene.action && (
        <p className="text-sm font-medium text-ink leading-snug mb-2.5">{scene.action}</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 last:mb-0">
          {tags.map((t, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline">
              {t}
            </span>
          ))}
        </div>
      )}

      {scene.dialogue.length > 0 && (
        <dl className="space-y-1 border-t border-hairline pt-2.5">
          {scene.dialogue.map((d, i) => (
            <div key={i} className="flex gap-2 text-xs leading-snug">
              <dt className="font-medium text-steel shrink-0">{d.character}</dt>
              <dd className="text-ink">{d.line}</dd>
            </div>
          ))}
        </dl>
      )}

      {proposal && (
        <div className="mt-3 rounded-md border border-[#3772cf]/40 bg-[#3772cf]/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#3772cf] mb-1.5">Suggested</div>
          <dl className="space-y-1 mb-2">
            {Object.entries(proposal.changes).map(([k, v]) => (
              <div key={k} className="text-xs">
                <span className="text-stone">{k}: </span>
                <span className="text-ink">{Array.isArray(v) ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </dl>
          {proposal.rationale && <p className="text-[11px] text-steel mb-2">{proposal.rationale}</p>}
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
          <div key={i} className="flex gap-1.5">
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
        ))}
        <button
          onClick={() => set({ dialogue: [...draft.dialogue, { character: '', line: '' }] })}
          className="text-[11px] text-steel hover:text-ink transition-colors"
        >
          + Add dialogue line
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
