// frontend/src/studio/views/ChapterView.tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getChunkScenes,
  getChunkText,
  type ChunkScenes,
  type ChunkText,
} from '../../api/pipeline'
import { SceneList } from '../../components/SceneList'

/**
 * Dedicated chapter page reached by clicking a chunk in the parse view.
 * Shows the chunk's raw source text in a scrollable window, then its parsed
 * scene cards below. Loads everything from the pipeline API by episode + chunk.
 */
export function ChapterView() {
  const { id = '', episodeId = '', chunkId = '' } = useParams()

  const [text, setText] = useState<ChunkText | null>(null)
  const [scenes, setScenes] = useState<ChunkScenes | null>(null)
  const [loading, setLoading] = useState(true)
  const [textError, setTextError] = useState('')
  const [notParsed, setNotParsed] = useState(false)
  const [scenesError, setScenesError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setTextError('')
    setScenesError('')
    setNotParsed(false)

    getChunkText(episodeId, chunkId)
      .then(t => alive && setText(t))
      .catch(e => alive && setTextError(String(e)))

    getChunkScenes(episodeId, chunkId)
      .then(s => alive && setScenes(s))
      .catch(e => {
        if (!alive) return
        // 409 = chunked but not parsed yet — that's an expected state, not an error.
        if (/\b409\b/.test(String(e))) setNotParsed(true)
        else setScenesError(String(e))
      })
      .finally(() => alive && setLoading(false))

    return () => {
      alive = false
    }
  }, [episodeId, chunkId])

  return (
    <div className="max-w-5xl">
      <Link
        to={`/project/${id}/parse`}
        className="inline-flex items-center gap-1.5 text-xs text-steel hover:text-ink mb-4"
      >
        ← Back to parsing
      </Link>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">
        {episodeId}
      </p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">
        Chapter <span className="font-mono">{chunkId}</span>
      </h1>
      <p className="text-sm text-steel mt-1 mb-6">
        {text?.word_count != null ? `${text.word_count.toLocaleString()} words` : 'Source text'}
        {scenes ? ` · ${scenes.scenes.length} scenes` : ''}
      </p>

      {/* Raw source text window */}
      <section className="mb-7">
        <h2 className="text-sm font-semibold text-ink mb-2">Raw text</h2>
        <div className="rounded-lg border border-hairline bg-canvas">
          {loading && !text ? (
            <div className="p-4 space-y-2 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-3 rounded-xs bg-hairline" style={{ width: `${90 - i * 8}%` }} />
              ))}
            </div>
          ) : textError ? (
            <div className="p-4 text-xs text-brand-error">{textError}</div>
          ) : (
            <pre className="max-h-80 overflow-y-auto p-4 text-xs leading-relaxed text-steel whitespace-pre-wrap font-mono">
              {text?.text}
            </pre>
          )}
        </div>
      </section>

      {/* Parsed scenes */}
      <section>
        <h2 className="text-sm font-semibold text-ink mb-2">Scenes</h2>
        {loading && !scenes && !notParsed ? (
          <SceneSkeleton />
        ) : notParsed ? (
          <div className="rounded-lg border border-dashed border-hairline bg-canvas p-6 text-center text-sm text-steel">
            This chapter hasn’t been parsed yet.
            <div className="mt-1 text-xs text-stone">Parse it from the chunk list to extract scenes.</div>
          </div>
        ) : scenesError ? (
          <div className="text-xs text-brand-error">{scenesError}</div>
        ) : scenes ? (
          <SceneList scenes={scenes.scenes} />
        ) : null}
      </section>
    </div>
  )
}

function SceneSkeleton() {
  return (
    <div className="space-y-2.5 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-canvas border border-hairline rounded-md p-4 space-y-2.5">
          <div className="h-2.5 w-14 rounded-xs bg-hairline" />
          <div className="h-3.5 w-3/4 rounded-xs bg-hairline" />
          <div className="flex gap-1.5">
            <div className="h-4 w-20 rounded-xs bg-hairline" />
            <div className="h-4 w-16 rounded-xs bg-hairline" />
          </div>
        </div>
      ))}
    </div>
  )
}
