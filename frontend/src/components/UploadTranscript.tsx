// frontend/src/components/UploadTranscript.tsx
import { useRef, useState } from 'react'
import { chunkTranscript } from '../api/pipeline'
import { computeMetrics, type TranscriptMetrics } from './transcriptMetrics'

type Phase = 'idle' | 'chunking' | 'chunked' | 'error'

interface Props {
  /** Project the transcript belongs to — episodes are namespaced under it. */
  projectId: string
  /** Called with the new episode id after a successful chunk. */
  onChunked?: (episodeId: string) => void
}

/** "Chapter 1–5!" → "chapter-1-5"; empty → a unique fallback. */
function slugify(s: string): string {
  const slug = s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `transcript-${Date.now().toString(36)}`
}

export function UploadTranscript({ projectId, onChunked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const readReq = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [lastChunked, setLastChunked] = useState<{ name: string; count: number } | null>(null)
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState<TranscriptMetrics | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')

  // Skim the file in-browser as soon as it is chosen: size, counts, language.
  async function onFileChange(f: File) {
    setFile(f)
    setName(f.name.replace(/\.[^.]+$/, ''))
    setPhase('idle')
    setError('')
    setMetrics(null)
    setReadError('')
    setReading(true)
    const req = ++readReq.current
    try {
      const text = await f.text()
      if (readReq.current !== req) return
      setMetrics(computeMetrics(text, f.size))
    } catch {
      if (readReq.current !== req) return
      setReadError('Could not read this file.')
    } finally {
      if (readReq.current === req) setReading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) onFileChange(f)
  }

  async function chunk() {
    if (!file) return
    const display = (name.trim() || file.name.replace(/\.[^.]+$/, '')).trim()
    const episodeId = `${projectId}__${slugify(display)}`
    setPhase('chunking')
    setError('')
    try {
      const result = await chunkTranscript(file, episodeId, display)
      setLastChunked({ name: result.display_name || display, count: result.chunk_count })
      setPhase('chunked')
      onChunked?.(result.episode_id)
      // Reset so the next transcript can be added.
      setFile(null)
      setName('')
      setMetrics(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-5 mb-6">
      <h2 className="text-sm font-semibold text-ink mb-3">Upload &amp; Chunk Transcript</h2>

      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-hairline rounded-lg p-8 text-center cursor-pointer hover:border-[#3772cf]/50 hover:bg-[#3772cf]/[0.03] transition-colors mb-4"
      >
        <div className="text-steel text-sm">
          {file ? file.name : 'Drop .txt file or click to browse'}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(f) }}
        />
      </div>

      {file && (
        <div className="mb-4 rounded-md border border-hairline bg-surface px-4 py-3">
          {reading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-2.5 w-12 rounded-xs bg-hairline" />
                  <div className="h-3.5 w-16 rounded-xs bg-hairline" />
                </div>
              ))}
            </div>
          ) : readError ? (
            <div className="text-xs text-brand-error">{readError}</div>
          ) : metrics ? (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
              <Stat label="Size" value={metrics.sizeLabel} mono />
              <Stat label="Words" value={metrics.wordCount.toLocaleString()} mono />
              <Stat label="Characters" value={metrics.charCount.toLocaleString()} mono />
              <Stat label="Language" value={metrics.language} hint="detected" />
            </dl>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <label htmlFor="transcript-name" className="text-xs text-steel w-28 shrink-0">
          Transcript name
        </label>
        <input
          id="transcript-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Chapters 1–5"
          className="flex-1 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-[#3772cf]"
        />
      </div>

      <button
        onClick={chunk}
        disabled={!file || phase === 'chunking'}
        className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
      >
        {phase === 'chunking' ? 'Chunking…' : 'Chunk Transcript'}
      </button>

      {phase === 'chunked' && lastChunked && (
        <div className="mt-3 text-xs text-[#00b48a] font-medium">
          “{lastChunked.name}” chunked into {lastChunked.count} file(s) — its card is below.
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
    </div>
  )
}

function Stat({
  label,
  value,
  mono,
  hint,
}: {
  label: string
  value: string
  mono?: boolean
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider font-mono text-stone">{label}</dt>
      <dd className={`text-sm font-medium text-ink truncate ${mono ? 'font-mono' : ''}`}>
        {value}
        {hint && <span className="ml-1.5 text-xs font-normal text-stone">{hint}</span>}
      </dd>
    </div>
  )
}
