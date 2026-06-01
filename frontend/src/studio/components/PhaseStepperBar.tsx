import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project, Phase } from '../types'
import { PHASE_ORDER, PHASE_META, phasePath, isPhaseReachable } from '../phases'

interface Props {
  project: Project
  current: Phase
  onRename: (title: string) => void
}

export function PhaseStepperBar({ project, current, onRename }: Props) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.title)

  function commit() {
    const next = draft.trim()
    if (next && next !== project.title) onRename(next)
    else setDraft(project.title)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-1 border-b border-hairline bg-canvas px-2 -mx-8 -mt-8 mb-8 h-12">
      {PHASE_ORDER.map((phase, i) => {
        const status = project.phases[phase]
        const isCurrent = phase === current
        const reachable = isPhaseReachable(project, phase)
        const done = status === 'complete'
        return (
          <div key={phase} className="flex items-center">
            {i > 0 && <span className="text-hairline px-1 text-xs">›</span>}
            <button
              disabled={!reachable}
              onClick={() => reachable && navigate(phasePath(project.id, phase))}
              className={`flex items-center gap-2 px-3 h-12 text-sm border-b-2 transition-colors ${
                isCurrent ? 'border-[#3772cf] text-[#3772cf] font-medium'
                : done ? 'border-transparent text-[#00b48a]'
                : reachable ? 'border-transparent text-steel hover:text-ink'
                : 'border-transparent text-muted cursor-not-allowed'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                isCurrent ? 'bg-[#3772cf] text-white'
                : done ? 'bg-[#00b48a] text-white'
                : 'bg-hairline text-steel'
              }`}>
                {done ? '✓' : i + 1}
              </span>
              {PHASE_META[phase].label}
            </button>
          </div>
        )
      })}

      <div className="ml-auto pr-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(project.title); setEditing(false) }
            }}
            className="text-sm text-ink bg-surface border border-hairline rounded-sm px-2 py-1 outline-none focus:border-[#3772cf]"
          />
        ) : (
          <button
            onClick={() => { setDraft(project.title); setEditing(true) }}
            className="text-sm text-steel hover:text-ink"
            title="Click to rename"
          >
            {project.title}
          </button>
        )}
      </div>
    </div>
  )
}
