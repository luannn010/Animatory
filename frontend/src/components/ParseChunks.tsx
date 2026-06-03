// frontend/src/components/ParseChunks.tsx
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { listChunks, parseEpisode, type ChunkInfo } from '../api/pipeline'
import { api } from '../api'

interface Props {
  episodeId: string
}

/**
 * Drives the parse step independently of chunking: lists the episode's chunks
 * (with per-chunk parse status) and lets the user parse all or a selected subset.
 * Clicking a chunk navigates to its dedicated chapter page (raw text + scenes).
 */
export function ParseChunks({ episodeId }: Props) {
  const { id: projectId = '' } = useParams()
  const navigate = useNavigate()

  const [chunks, setChunks] = useState<ChunkInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState('')
  // Live parse progress, derived from streamed "[done/total]" log lines.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listChunks(episodeId)
      setChunks(data.chunks)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [episodeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  function openChapter(chunkId: string) {
    navigate(`/project/${projectId}/chapter/${encodeURIComponent(episodeId)}/${encodeURIComponent(chunkId)}`)
  }

  function toggle(chunkId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(chunkId)) next.delete(chunkId)
      else next.add(chunkId)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev =>
      prev.size === chunks.length ? new Set() : new Set(chunks.map(c => c.chunk_id)),
    )
  }

  // chunkIds === undefined → parse all (bulk); a list → parse just those.
  async function runParse(chunkIds?: string[]) {
    if (parsing) return
    setParsing(true)
    setError('')
    setProgress(null)
    const label = chunkIds ? `${chunkIds.length} selected chunk(s)` : 'all chunks'
    setLogs([`Parsing ${label}…`])
    try {
      const { run_id } = await parseEpisode(episodeId, chunkIds)
      setLogs(l => [...l, `Run ${run_id} started`])
      const es = api.streamRun(run_id)
      es.addEventListener('message', (ev: Event) => {
        const msg = ev as MessageEvent
        try {
          const event = JSON.parse(msg.data as string)
          if (event.type === 'log') {
            // Lines tagged "[done/total]" drive the progress bar.
            const m = /\[(\d+)\/(\d+)\]/.exec(event.data.message)
            if (m) setProgress({ done: Number(m[1]), total: Number(m[2]) })
            setLogs(l => [...l, event.data.message])
          }
          if (event.type === 'complete') {
            es.close()
            setParsing(false)
            setProgress(null)
            setSelected(new Set())
            setLogs(l => [...l, 'Parse complete'])
            refresh()
          }
          if (event.data?.status === 'failed') {
            es.close()
            setParsing(false)
            setProgress(null)
            setError(event.data.error ?? 'Parse failed')
          }
        } catch {
          /* ignore malformed event */
        }
      })
    } catch (err) {
      setParsing(false)
      setProgress(null)
      setError(String(err))
    }
  }

  const allSelected = chunks.length > 0 && selected.size === chunks.length

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">
          Parse chunks <span className="text-steel font-normal">· {episodeId}</span>
        </h2>
        <button
          onClick={refresh}
          disabled={loading || parsing}
          className="text-xs text-steel hover:text-ink disabled:opacity-50"
        >
          ↻ Refresh
        </button>
      </div>

      {chunks.length === 0 ? (
        <div className="text-xs text-steel py-4">
          {loading ? 'Loading chunks…' : 'No chunks yet — chunk a transcript first.'}
        </div>
      ) : (
        <>
          <div className="border border-hairline rounded-md overflow-hidden mb-4">
            <div className="flex items-center gap-3 px-3 py-2 bg-surface text-[11px] font-medium text-steel border-b border-hairline">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={parsing}
                aria-label="Select all chunks"
                className="accent-[#3772cf]"
              />
              <span className="w-16">Chunk</span>
              <span className="w-20 text-right">Words</span>
              <span className="flex-1">Status</span>
              <span className="w-3.5 shrink-0" aria-hidden="true" />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {chunks.map(c => (
                <div
                  key={c.chunk_id}
                  className="flex items-center gap-3 px-3 py-2 text-xs border-b border-hairline last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.chunk_id)}
                    onChange={() => toggle(c.chunk_id)}
                    disabled={parsing}
                    aria-label={`Select ${c.chunk_id}`}
                    className="accent-[#3772cf]"
                  />
                  <button
                    type="button"
                    onClick={() => openChapter(c.chunk_id)}
                    title="Open chapter"
                    className="flex-1 flex items-center gap-3 py-0.5 rounded-xs text-left transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
                  >
                    <span className="w-16 font-mono text-ink">{c.chunk_id}</span>
                    <span className="w-20 text-right text-steel">{c.word_count ?? '—'}</span>
                    <span className="flex-1">
                      {c.parsed ? (
                        <span className="text-[#00b48a] font-medium">
                          ✓ parsed{c.scene_count != null ? ` · ${c.scene_count} scenes` : ''}
                        </span>
                      ) : (
                        <span className="text-stone">not parsed</span>
                      )}
                    </span>
                    <NavArrow />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => runParse(Array.from(selected))}
              disabled={parsing || selected.size === 0}
              className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {parsing ? 'Parsing…' : `Parse selected (${selected.size})`}
            </button>
            <button
              onClick={() => runParse(undefined)}
              disabled={parsing}
              className="px-4 py-2 rounded-md border border-hairline text-steel text-sm hover:bg-surface disabled:opacity-50 transition-colors"
            >
              Parse all ({chunks.length})
            </button>
          </div>
        </>
      )}

      {parsing && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5 text-xs">
            <span className="flex items-center gap-2 text-steel">
              <Spinner />
              {progress
                ? `Parsing chunk ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : 'Starting…'}
            </span>
            <span className="font-mono text-stone">
              {progress && progress.total > 0
                ? Math.round((progress.done / progress.total) * 100)
                : 0}
              %
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-hairline overflow-hidden">
            <div
              className="h-full rounded-full bg-[#3772cf] transition-[width] duration-300"
              style={{
                width: `${progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4 rounded-md border border-hairline bg-surface p-3 font-mono text-xs text-steel space-y-0.5 max-h-40 overflow-y-auto">
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
    </div>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 animate-spin text-[#3772cf]" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function NavArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-stone">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
