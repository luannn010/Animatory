import { useState } from 'react'
import type { AgentSchema } from '../../types'
import type { SceneFanout, SceneRun, SceneStatus } from '../../types/canvas'
import { api } from '../../api'

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
}

const STATUS_COLOR: Record<SceneStatus, string> = {
  queued:   'bg-muted text-stone',
  running:  'bg-[#00d4a4]/15 text-[#1d8f68]',
  done:     'bg-[#00d4a4]/15 text-[#1d8f68]',
  failed:   'bg-[#d45656]/15 text-[#d45656]',
  retrying: 'bg-[#c37d0d]/15 text-[#c37d0d]',
}

function SceneDetail({ scene, agentId }: { scene: SceneRun; agentId: string }) {
  const [triggering, setTriggering] = useState(false)
  const [lastRunId, setLastRunId] = useState<string | null>(null)

  async function handleReRun() {
    setTriggering(true)
    try {
      const res = await api.triggerRun(agentId, {
        context: { ...scene.inputs, scene_id: scene.scene_id },
        system_prompt: '',
      })
      setLastRunId(res.run_id)
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-stone">Run ID</span>
        <span className="font-mono text-charcoal truncate">{scene.run_id ?? '—'}</span>
        <span className="text-stone">Attempts</span>
        <span className="font-mono text-charcoal">{scene.attempts}</span>
        <span className="text-stone">Duration</span>
        <span className="font-mono text-charcoal">{scene.duration_s != null ? `${scene.duration_s}s` : '—'}</span>
        <span className="text-stone">Cost</span>
        <span className="font-mono text-charcoal">{scene.cost != null ? `$${scene.cost.toFixed(4)}` : '—'}</span>
        <span className="text-stone">Acceptance</span>
        <span className="font-mono text-charcoal">{scene.acceptance_passed == null ? '—' : scene.acceptance_passed ? 'passed' : 'failed'}</span>
      </div>

      {scene.error && (
        <p className="text-[#d45656] bg-[#d45656]/8 rounded px-2 py-1.5">{scene.error}</p>
      )}

      {lastRunId && (
        <p className="text-[#00d4a4] text-[11px]">Re-run triggered: <span className="font-mono">{lastRunId}</span></p>
      )}

      <button
        onClick={handleReRun}
        disabled={triggering}
        className="w-full py-1.5 rounded-full bg-ink text-white text-xs font-medium disabled:opacity-50"
      >
        {triggering ? 'Triggering…' : 'Re-run this scene'}
      </button>
    </div>
  )
}

export function ScenesTab({ agent, fanout }: Props) {
  const scenes = fanout?.scenes ?? []
  const [activeIdx, setActiveIdx] = useState(0)

  if (scenes.length === 0) {
    return <p className="text-sm text-stone text-center py-8">No scenes yet — trigger a run to create the first scene.</p>
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {scenes.map((s, i) => (
          <button
            key={s.scene_id}
            onClick={() => setActiveIdx(i)}
            className={[
              'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
              activeIdx === i
                ? 'bg-ink text-white'
                : 'bg-surface border border-hairline text-steel hover:text-ink',
            ].join(' ')}
          >
            {s.scene_id.toUpperCase()}
            {' '}
            <span className={`inline-block px-1 py-px rounded text-[9px] font-semibold ${STATUS_COLOR[s.status]}`}>
              {s.status}
            </span>
          </button>
        ))}
      </div>

      {scenes[activeIdx] && (
        <div>
          <p className="text-sm font-medium text-ink">{scenes[activeIdx].scene_label}</p>
          <SceneDetail scene={scenes[activeIdx]} agentId={agent.id} />
        </div>
      )}
    </div>
  )
}
