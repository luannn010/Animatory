import { useEffect, useState } from 'react'
import type { AgentSchema } from '../types'
import type { SceneFanout } from '../types/canvas'
import { api } from '../api'
import { PipelineCanvas } from '../canvas/PipelineCanvas'
import { SCENE_FANOUTS } from '../mock/sceneMock'
import { USE_MOCK } from '../config'

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
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-sm text-stone animate-pulse">Loading pipeline…</span>
      </div>
    )
  }

  if (error) {
    return <p className="text-[#d45656] text-sm p-8">{error}</p>
  }

  const fanouts: Record<string, SceneFanout> = USE_MOCK ? SCENE_FANOUTS : {}

  return (
    <div className="-m-8 h-[calc(100vh-4rem)]">
      <PipelineCanvas agents={agents} fanouts={fanouts} />
    </div>
  )
}
