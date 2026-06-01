import { useState } from 'react'
import type { AgentSchema } from '../../types'
import type { SceneFanout } from '../../types/canvas'

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
}

export function IOTab({ agent, fanout }: Props) {
  const scenes = fanout?.scenes ?? []
  const [activeIdx, setActiveIdx] = useState(0)
  const scene = scenes[activeIdx]

  return (
    <div className="space-y-3">
      {scenes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scenes.map((s, i) => (
            <button
              key={s.scene_id}
              onClick={() => setActiveIdx(i)}
              className={[
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                activeIdx === i ? 'bg-ink text-white' : 'bg-surface border border-hairline text-steel hover:text-ink',
              ].join(' ')}
            >
              {s.scene_id.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Input</p>
          <pre className="bg-surface border border-hairline rounded-lg p-2.5 text-[10px] font-mono text-charcoal overflow-auto max-h-48 whitespace-pre-wrap">
            {scene
              ? JSON.stringify(scene.inputs, null, 2)
              : JSON.stringify(
                  Object.fromEntries(agent.inputs.map(i => [i.name, `<${i.type}>`])),
                  null, 2
                )
            }
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Output</p>
          {scene && scene.outputs.length > 0 ? (
            <ul className="space-y-2">
              {scene.outputs.map(o => (
                <li key={o.name} className="bg-surface border border-hairline rounded-lg p-2.5 text-[10px]">
                  <p className="font-mono font-semibold text-charcoal">{o.name}</p>
                  <p className="text-stone font-mono">{o.type}</p>
                  {o.url && (
                    <a href={o.url} target="_blank" rel="noreferrer" className="text-[#3772cf] hover:underline break-all">
                      {o.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="bg-surface border border-hairline rounded-lg p-2.5 text-[10px] font-mono text-stone overflow-auto max-h-48">
              {scene ? 'No outputs yet.' : JSON.stringify(
                Object.fromEntries(agent.outputs.map(o => [o.name, `<${o.type}>`])),
                null, 2
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
