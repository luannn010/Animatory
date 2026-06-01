import { useEffect, useRef, useState } from 'react'
import type { AgentSchema } from '../../types'
import type { SceneFanout } from '../../types/canvas'
import { api } from '../../api'

interface Props {
  agent: AgentSchema
  fanout: SceneFanout | null
}

export function LogsTab({ agent: _agent, fanout }: Props) {
  const scenes = fanout?.scenes ?? []
  const [activeIdx, setActiveIdx] = useState(0)
  const [lines, setLines] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const activeScene = scenes[activeIdx]

  useEffect(() => {
    if (!activeScene?.run_id) {
      setLines(activeScene?.logs ?? [])
      setStreaming(false)
      return
    }

    const runId = activeScene.run_id
    if (activeScene.status === 'done' || activeScene.status === 'failed') {
      setLines(activeScene.logs)
      setStreaming(false)
      return
    }

    setLines([])
    setStreaming(true)
    const es = api.streamRun(runId)

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string; data: { message?: string } }
        if (event.type === 'log' && event.data.message) {
          setLines(prev => [...prev, event.data.message!])
        }
        if (event.type === 'complete') {
          setStreaming(false)
        }
      } catch { /* ignore */ }
    })

    return () => {
      es.close()
      setStreaming(false)
    }
  }, [activeScene?.run_id, activeScene?.status])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines])

  if (scenes.length === 0) {
    return <p className="text-sm text-stone text-center py-8">No scenes to show logs for.</p>
  }

  return (
    <div className="space-y-3">
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

      <div
        ref={logRef}
        className="h-64 overflow-y-auto bg-[#0d1117] rounded-lg p-3 font-mono text-[11px] text-[#c9d1d9] space-y-0.5"
      >
        {lines.length === 0 ? (
          <span className="text-[#484f58]">{activeScene?.run_id ? 'Waiting for logs…' : 'No run yet.'}</span>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
        {streaming && <div className="text-[#00d4a4] animate-pulse">▌</div>}
      </div>
    </div>
  )
}
