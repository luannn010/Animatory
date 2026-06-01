import type { AgentSchema } from '../types'
import type { SceneFanout, PipelineState } from '../types/canvas'
import { OverviewTab } from './tabs/OverviewTab'
import { ScenesTab }   from './tabs/ScenesTab'
import { PromptTab }   from './tabs/PromptTab'
import { LogsTab }     from './tabs/LogsTab'
import { IOTab }       from './tabs/IOTab'

type Tab = PipelineState['panelTab']

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'scenes',   label: 'Scenes'   },
  { id: 'prompt',   label: 'Prompt'   },
  { id: 'logs',     label: 'Logs'     },
  { id: 'io',       label: 'I/O'      },
]

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  onClose: () => void
}

export function NodePanel({ agent, fanout, activeTab, onTabChange, onClose }: Props) {
  return (
    <div className="absolute top-4 right-4 z-10 w-[420px] max-h-[calc(100vh-6rem)] flex flex-col bg-canvas border border-hairline rounded-xl shadow-xl overflow-hidden">
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-hairline shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-mono text-stone truncate">{agent.id}</p>
          <h2 className="text-base font-semibold text-ink leading-snug truncate">{agent.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="ml-3 shrink-0 text-steel hover:text-ink transition-colors text-lg leading-none mt-0.5"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="flex gap-0 border-b border-hairline shrink-0 px-1 pt-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={[
              'px-4 py-2 text-xs font-medium rounded-t transition-colors',
              activeTab === tab.id
                ? 'text-ink border-b-2 border-[#00d4a4]'
                : 'text-steel hover:text-charcoal',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'overview' && <OverviewTab agent={agent} />}
        {activeTab === 'scenes'   && <ScenesTab   agent={agent} fanout={fanout} />}
        {activeTab === 'prompt'   && <PromptTab   agent={agent} />}
        {activeTab === 'logs'     && <LogsTab     agent={agent} fanout={fanout} />}
        {activeTab === 'io'       && <IOTab        agent={agent} fanout={fanout} />}
      </div>
    </div>
  )
}
