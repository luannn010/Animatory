import type { Node, Edge } from '@xyflow/react'
import type { AgentSchema } from '../types'
import type { AgentNodeData, SceneFanout } from '../types/canvas'
import { NODE_POSITIONS, NODE_WIDTH, NODE_HEIGHT } from './nodeLayout'
import { PIPELINE_EDGES } from './edgeDefinitions'

export function buildNodes(
  agents: AgentSchema[],
  fanouts: Record<string, SceneFanout>,
): Node<AgentNodeData>[] {
  return agents.map(agent => ({
    id: agent.id,
    type: 'agentNode',
    position: NODE_POSITIONS[agent.id] ?? { x: 0, y: 0 },
    data: { agent, fanout: fanouts[agent.id] ?? null },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }))
}

export function buildEdges(agents: AgentSchema[]): Edge[] {
  const ids = new Set(agents.map(a => a.id))
  return PIPELINE_EDGES.filter(e => ids.has(e.source) && ids.has(e.target))
}
