import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { RunEvent, RunStatus, OutputArtifact } from '../types'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'

export function RunMonitor() {
  const { runId } = useParams<{ runId: string }>()
  const [status, setStatus] = useState<RunStatus>('queued')
  const [attempts, setAttempts] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [outputs, setOutputs] = useState<OutputArtifact[]>([])
  const [cost, setCost] = useState<number | null>(null)
  const [gpuSeconds, setGpuSeconds] = useState<number | null>(null)
  const [durationS, setDurationS] = useState<number | null>(null)
  const [acceptancePassed, setAcceptancePassed] = useState<boolean | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [startTime] = useState(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const logsRef = useRef<HTMLDivElement>(null)

  const done = status === 'done' || status === 'failed'

  useEffect(() => {
    if (done) return
    const id = setInterval(() => setElapsed(Date.now() - startTime), 500)
    return () => clearInterval(id)
  }, [done, startTime])

  useEffect(() => {
    if (!runId) return
    const source = api.streamRun(runId)

    function onMessage(e: MessageEvent) {
      const event = JSON.parse(e.data as string) as RunEvent
      if (event.data.status) setStatus(event.data.status)
      if (event.data.attempts !== undefined) setAttempts(event.data.attempts)
      if (event.data.message) setLogs(prev => [...prev, event.data.message!])
      if (event.type === 'complete') {
        if (event.data.cost != null) setCost(event.data.cost)
        if (event.data.gpu_seconds != null) setGpuSeconds(event.data.gpu_seconds)
        if (event.data.duration_s != null) setDurationS(event.data.duration_s)
        if (event.data.acceptance_passed != null) setAcceptancePassed(event.data.acceptance_passed)
        if (event.data.outputs) setOutputs(event.data.outputs)
        if (event.data.error) setRunError(event.data.error)
      }
    }

    source.addEventListener('message', onMessage)
    return () => {
      source.removeEventListener('message', onMessage)
      source.close()
    }
  }, [runId])

  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' })
  }, [logs])

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-xs text-stone mb-8 font-mono">
        <Link to="/runs" className="text-steel">Runs</Link>
        <span>/</span>
        <span className="text-ink">{runId}</span>
        <span>/</span>
        <span className="text-ink">monitor</span>
      </div>

      <div className="bg-canvas rounded-lg border border-hairline p-6 mb-4 shadow-[rgba(0,0,0,0.04)_0px_1px_2px_0px]">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-ink">Run Monitor</h1>
          <StatusBadge status={status} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Run ID"   value={runId ?? '—'} mono />
          <Stat label="Attempts" value={String(attempts)} />
          <Stat label="Elapsed"  value={done && durationS ? `${durationS.toFixed(1)}s` : `${(elapsed / 1000).toFixed(1)}s`} />
          <Stat label="Cost"     value={cost != null ? `$${cost.toFixed(4)}` : '—'} />
        </div>
        {gpuSeconds != null && (
          <div className="mt-3 pt-3 border-t border-hairline/60">
            <Stat label="GPU Seconds" value={`${gpuSeconds}s`} />
          </div>
        )}
      </div>

      <div className="bg-[#1c1c1e] rounded-lg overflow-hidden mb-4">
        <div className="px-4 py-2 border-b border-[#1f1f1f] flex items-center justify-between">
          <span className="text-xs text-[#b3b3b3] font-mono">stream log</span>
          {!done && <span className="text-xs text-[#00d4a4] font-mono animate-pulse">● live</span>}
        </div>
        <div ref={logsRef} className="p-4 h-48 overflow-y-auto space-y-1 font-mono text-xs text-white">
          {logs.length === 0 && <span className="text-[#b3b3b3]">Waiting for events…</span>}
          {logs.map((line, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-[#b3b3b3] mr-3 select-none">{String(i + 1).padStart(3, '0')}</span>
              {line}
            </div>
          ))}
        </div>
      </div>

      {runError && (
        <div className="bg-[#d45656]/10 border border-[#d45656]/30 rounded-lg px-6 py-4 mb-4">
          <p className="text-sm text-[#d45656] font-mono">{runError}</p>
        </div>
      )}

      {acceptancePassed != null && (
        <div className={`rounded-lg px-6 py-4 mb-4 border ${acceptancePassed ? 'bg-[#00d4a4]/10 border-[#00d4a4]/30' : 'bg-[#d45656]/10 border-[#d45656]/30'}`}>
          <p className={`text-sm font-medium ${acceptancePassed ? 'text-[#00b48a]' : 'text-[#d45656]'}`}>
            {acceptancePassed ? '✓ Acceptance checks passed' : '✗ Acceptance checks failed'}
          </p>
        </div>
      )}

      {outputs.length > 0 && (
        <div className="bg-canvas rounded-lg border border-hairline p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-4">Outputs</p>
          <div className="grid grid-cols-2 gap-4">
            {outputs.map(out => <OutputCard key={out.name} artifact={out} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-stone">{label}</p>
      <p className={`text-sm font-medium text-ink mt-1 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function OutputCard({ artifact }: { artifact: OutputArtifact }) {
  if (artifact.type === 'image') {
    return (
      <div className="rounded-md overflow-hidden border border-hairline">
        <img src={artifact.url} alt={artifact.name} className="w-full object-cover" />
        <p className="px-3 py-2 text-xs font-mono text-stone truncate">{artifact.name}</p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-hairline px-4 py-3 flex items-center gap-3">
      <span className="text-xl">{artifact.type === 'audio' ? '♪' : artifact.type === 'video' ? '▶' : '⬡'}</span>
      <div className="min-w-0">
        <p className="text-xs font-mono text-ink truncate">{artifact.name}</p>
        <p className="text-xs text-stone">{artifact.type}{artifact.size_bytes ? ` · ${(artifact.size_bytes / 1024).toFixed(0)}kb` : ''}</p>
      </div>
    </div>
  )
}
