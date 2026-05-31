import { useState } from 'react'
import type { AgentSchema } from '../types'
import { StackBadge, stackBorderClass } from '../components/StackBadge'
import { RunTriggerPanel } from './RunTriggerPanel'

interface Props { agent: AgentSchema }

export function AgentCard({ agent }: Props) {
  const [showTrigger, setShowTrigger] = useState(false)

  return (
    <>
      <div className={`bg-canvas rounded-lg border border-hairline border-l-4 ${stackBorderClass(agent.stack)} shadow-[rgba(0,0,0,0.04)_0px_1px_2px_0px]`}>
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StackBadge stack={agent.stack} />
              <span className="text-xs font-mono text-stone">{agent.id}</span>
            </div>
            <h3 className="text-base font-semibold text-ink leading-snug">{agent.name}</h3>
            <p className="text-xs text-steel mt-1">{agent.role}</p>
          </div>
          <button
            onClick={() => setShowTrigger(true)}
            className="shrink-0 px-4 py-1.5 rounded-full bg-ink text-white text-xs font-medium"
          >
            Run
          </button>
        </div>

        <div className="px-6 pb-4">
          <p className="text-sm text-charcoal leading-relaxed">{agent.responsibility}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 px-6 pb-6 border-t border-hairline/60 pt-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Inputs</p>
            <ul className="space-y-1">
              {agent.inputs.map(io => (
                <li key={io.name} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-charcoal">{io.name}</span>
                  <span className="text-xs text-stone font-mono">{io.type}</span>
                  {io.required && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1 py-px rounded bg-[#d45656] text-white">req</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Outputs</p>
            <ul className="space-y-1">
              {agent.outputs.map(io => (
                <li key={io.name} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-charcoal">{io.name}</span>
                  <span className="text-xs text-stone font-mono">{io.type}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {agent.acceptance.length > 0 && (
          <div className="px-6 pb-4 border-t border-hairline/60 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Acceptance</p>
            <ul className="space-y-1">
              {agent.acceptance.map(a => (
                <li key={a} className="flex items-start gap-2 text-xs text-steel">
                  <span className="text-[#00d4a4] mt-px">✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showTrigger && (
        <RunTriggerPanel agent={agent} onClose={() => setShowTrigger(false)} />
      )}
    </>
  )
}
