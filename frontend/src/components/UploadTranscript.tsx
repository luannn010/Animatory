// frontend/src/components/UploadTranscript.tsx
import { useRef, useState } from 'react'
import { chunkTranscript, parseEpisode } from '../api/pipeline'
import { api } from '../api'

type Phase = 'idle' | 'chunking' | 'parsing' | 'done' | 'error'

export function UploadTranscript() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [episodeName, setEpisodeName] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [chunkCount, setChunkCount] = useState(0)
  const [error, setError] = useState('')

  function onFileChange(f: File) {
    setFile(f)
    setEpisodeName(f.name.replace(/\.[^.]+$/, ''))
    setPhase('idle')
    setLogs([])
    setError('')
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) onFileChange(f)
  }

  async function process() {
    if (!file) return
    setPhase('chunking')
    setLogs([])
    setError('')
    try {
      const chunkResult = await chunkTranscript(file, episodeName || undefined)
      setChunkCount(chunkResult.chunk_count)
      setLogs(l => [...l, `Chunked: ${chunkResult.chunk_count} chunks`])

      setPhase('parsing')
      const parseResult = await parseEpisode(chunkResult.episode_id)
      setLogs(l => [...l, `Parsing started (run ${parseResult.run_id})`])

      const es = api.streamRun(parseResult.run_id)
      es.addEventListener('message', (ev: Event) => {
        const msg = ev as MessageEvent
        try {
          const event = JSON.parse(msg.data as string)
          if (event.type === 'log') {
            setLogs(l => [...l, event.data.message])
          }
          if (event.type === 'complete') {
            setPhase('done')
            setLogs(l => [...l, 'Parse complete'])
            es.close()
          }
          if (event.data?.status === 'failed') {
            setPhase('error')
            setError(event.data.error ?? 'Parse failed')
            es.close()
          }
        } catch {}
      })
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-5 mb-6">
      <h2 className="text-sm font-semibold text-ink mb-3">Upload Transcript</h2>

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
        onClick={process}
        disabled={!file || phase === 'chunking' || phase === 'parsing'}
        className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
      >
        {phase === 'chunking' ? 'Chunking...' : phase === 'parsing' ? 'Parsing...' : 'Process Transcript'}
      </button>

      {logs.length > 0 && (
        <div className="rounded-md border border-hairline bg-surface p-3 font-mono text-xs text-steel space-y-0.5 max-h-40 overflow-y-auto">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-500">{error}</div>
      )}

      {phase === 'done' && (
        <div className="mt-3 text-xs text-[#00b48a] font-medium">
          {chunkCount} chunks parsed - ready for next phase
        </div>
      )}
    </div>
  )
}
