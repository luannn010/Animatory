import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { AgentNodeData, SceneStatus } from '../types/canvas'
import { StackBadge, stackBorderClass } from '../components/StackBadge'

const STATUS_DOT: Record<SceneStatus, string> = {
  queued:   'bg-muted',
  running:  'bg-[#00d4a4] animate-pulse',
  done:     'bg-[#00d4a4]',
  failed:   'bg-[#d45656]',
  retrying: 'bg-[#c37d0d] animate-pulse',
}

function dominantStatus(fanout: AgentNodeData['fanout']): SceneStatus | 'idle' {
  if (!fanout || fanout.scenes.length === 0) return 'idle'
  if (fanout.scenes.some(s => s.status === 'running'))  return 'running'
  if (fanout.scenes.some(s => s.status === 'retrying')) return 'retrying'
  if (fanout.scenes.some(s => s.status === 'failed'))   return 'failed'
  if (fanout.scenes.every(s => s.status === 'done'))    return 'done'
  return 'queued'
}

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
  const { agent, fanout } = data
  const status = dominantStatus(fanout)
  const dotColor = status === 'idle' ? 'bg-stone/40' : STATUS_DOT[status]
  const sceneCount = fanout?.scenes.length ?? 0
  const doneCount  = fanout?.scenes.filter(s => s.status === 'done').length ?? 0

  return (
    <div
      className={[
        'bg-canvas rounded-lg border border-hairline border-l-4',
        stackBorderClass(agent.stack),
        selected ? 'ring-2 ring-[#00d4a4]/60 shadow-lg' : 'shadow-[rgba(0,0,0,0.06)_0px_1px_3px]',
        'w-[240px] cursor-pointer select-none',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left}  className="!bg-hairline !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-hairline !w-2 !h-2 !border-0" />

      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <StackBadge stack={agent.stack} />
        </div>
        <p className="text-sm font-semibold text-ink leading-snug truncate">{agent.name}</p>
        <p className="text-[11px] text-steel mt-0.5 truncate">{agent.role}</p>
      </div>

      <div className="flex items-center justify-between px-3 pb-2.5 border-t border-hairline/50 pt-2">
        <span className="text-[10px] font-mono text-stone">{agent.id}</span>
        {sceneCount > 0 && (
          <span className="text-[10px] text-steel tabular-nums">{doneCount}/{sceneCount}</span>
        )}
      </div>
    </div>
  )
})
