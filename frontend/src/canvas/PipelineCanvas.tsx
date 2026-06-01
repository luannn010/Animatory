import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentSchema } from '../types'
import type { AgentNodeData, SceneFanout, PipelineState } from '../types/canvas'
import { AgentNode } from './AgentNode'
import { buildNodes, buildEdges } from './pipelineData'
import { NodePanel } from '../panel/NodePanel'

const NODE_TYPES = { agentNode: AgentNode }

interface Props {
  agents: AgentSchema[]
  fanouts?: Record<string, SceneFanout>
}

const DEFAULT_EDGE_OPTS = {
  type: 'smoothstep',
  style: { stroke: '#d1d5db', strokeWidth: 1.5 },
}

export function PipelineCanvas({ agents, fanouts = {} }: Props) {
  const [nodes, , onNodesChange] = useNodesState<AgentNodeData>(buildNodes(agents, fanouts))
  const [edges, , onEdgesChange] = useEdgesState(buildEdges(agents))

  const [pipeline, setPipeline] = useState<PipelineState>({
    selectedNodeId: null,
    panelTab: 'overview',
  })

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setPipeline(prev => ({
      selectedNodeId: prev.selectedNodeId === node.id ? prev.selectedNodeId : node.id,
      panelTab: 'overview',
    }))
  }, [])

  const onPaneClick = useCallback(() => {
    setPipeline(prev => ({ ...prev, selectedNodeId: null }))
  }, [])

  const selectedAgent = agents.find(a => a.id === pipeline.selectedNodeId) ?? null
  const selectedFanout = pipeline.selectedNodeId ? (fanouts[pipeline.selectedNodeId] ?? null) : null

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTS}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        className="bg-surface"
      >
        <Background color="#e5e7eb" gap={24} />
        <Controls className="!bg-canvas !border-hairline !shadow-sm" />
        <MiniMap
          nodeColor={() => '#e5e7eb'}
          className="!bg-canvas !border-hairline"
        />
      </ReactFlow>

      {selectedAgent && (
        <NodePanel
          agent={selectedAgent}
          fanout={selectedFanout}
          activeTab={pipeline.panelTab}
          onTabChange={tab => setPipeline(prev => ({ ...prev, panelTab: tab }))}
          onClose={() => setPipeline(prev => ({ ...prev, selectedNodeId: null }))}
        />
      )}
    </div>
  )
}
