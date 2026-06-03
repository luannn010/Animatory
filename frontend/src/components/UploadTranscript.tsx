// frontend/src/components/UploadTranscript.tsx
import { useRef, useState } from 'react'
import { chunkTranscript } from '../api/pipeline'
import { computeMetrics, type TranscriptMetrics } from './transcriptMetrics'
import { ParseChunks } from './ParseChunks'

type Phase = 'idle' | 'chunking' | 'chunked' | 'error'

export function UploadTranscript() {
  const inputRef = useRef<HTMLInputElement>(null)
  const readReq = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [episodeName, setEpisodeName] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState<TranscriptMetrics | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')

  // Skim the file in-browser as soon as it is chosen: size, counts, and a
  // language guess — all before any upload. Guarded against out-of-order reads
  // when the user swaps files quickly.
  async function onFileChange(f: File) {
    setFile(f)
    setEpisodeName(f.name.replace(/\.[^.]+$/, ''))
    setPhase('idle')
    setEpisodeId(null)
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

  // Step 1 only: chunk the transcript into small files. Parsing is a separate,
  // explicit step handled by <ParseChunks> below.
  async function chunk() {
    if (!file) return
    setPhase('chunking')
    setError('')
    try {
      const result = await chunkTranscript(file, episodeName || undefined)
      setChunkCount(result.chunk_count)
      setEpisodeId(result.episode_id)
      setPhase('chunked')
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }

  return (
    <>
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
          <label className="text-xs text-steel w-28 shrink-0">Episode name</label>
          <input
            value={episodeName}
            onChange={e => setEpisodeName(e.target.value)}
            className="flex-1 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-[#3772cf]"
            placeholder="ep1"
          />
        </div>

        <button
          onClick={chunk}
          disabled={!file || phase === 'chunking'}
          className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {phase === 'chunking' ? 'Chunking…' : 'Chunk Transcript'}
        </button>

        {phase === 'chunked' && (
          <div className="mt-3 text-xs text-[#00b48a] font-medium">
            Chunked into {chunkCount} file(s) — parse them below.
          </div>
        )}

        {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
      </div>

      {episodeId && <ParseChunks episodeId={episodeId} />}
    </>
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
