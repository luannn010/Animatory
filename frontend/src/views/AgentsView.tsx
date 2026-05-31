import { useEffect, useState } from 'react'
import type { AgentSchema, AgentStack } from '../types'
import { api } from '../api'
import { AgentCard } from './AgentCard'

const STACK_ORDER: AgentStack[] = ['orchestration', 'comfyui', 'text', 'audio', 'image', 'video', 'utility']

const STACK_LABELS: Record<AgentStack, string> = {
  orchestration: 'Orchestration',
  comfyui:       'ComfyUI / Motion',
  text:          'Text / LLM',
  audio:         'Audio',
  image:         'Image Generation',
  video:         'Video',
  utility:       'Utility',
}

export function AgentsView() {
  const [agents, setAgents] = useState<AgentSchema[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getAgents()
      .then(setAgents)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl">
        {[...Array(4)].map((_, i) => <div key={i} className="h-40 rounded-lg bg-hairline animate-pulse" />)}
      </div>
    )
  }

  if (error) {
    return <p className="text-[#d45656] text-sm max-w-lg">{error}</p>
  }

  const byStack = STACK_ORDER.reduce<Partial<Record<AgentStack, AgentSchema[]>>>((acc, stack) => {
    const group = agents.filter(a => a.stack === stack)
    if (group.length) acc[stack] = group
    return acc
  }, {})

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Agent Pipeline</h1>
        <p className="text-sm text-steel mt-1">{agents.length} agents across {Object.keys(byStack).length} stacks</p>
      </div>

      <div className="space-y-10">
        {STACK_ORDER.filter(s => byStack[s]).map(stack => (
          <section key={stack}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-4 border-b border-hairline pb-2">
              {STACK_LABELS[stack]}
            </h2>
            <div className="space-y-4">
              {byStack[stack]!.map(agent => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
