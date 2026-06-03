// frontend/src/studio/views/ChapterView.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getChunkScenes, getChunkText, parseEpisode, refineChat,
  saveScenes, saveText, resetScenes, resetText,
  type ChatMessage, type PipelineScene, type ScenePatch, type TextCorrection,
} from '../../api/pipeline'
import { api } from '../../api'
import { applyCorrection } from '../../components/refine/corrections'
import { RawTextEditor } from '../../components/refine/RawTextEditor'
import { EditableSceneCard } from '../../components/refine/EditableSceneCard'
import { RefineChat } from '../../components/refine/RefineChat'

export function ChapterView() {
  const { id = '', episodeId = '', chunkId = '' } = useParams()

  // Text state
  const [text, setText] = useState('')
  const [textBaseline, setTextBaseline] = useState('')
  const [textEdited, setTextEdited] = useState(false)
  const [textWordCount, setTextWordCount] = useState<number | null>(null)
  const [savingText, setSavingText] = useState(false)
  const [corrections, setCorrections] = useState<TextCorrection[]>([])

  // Scenes state
  const [scenes, setScenes] = useState<PipelineScene[]>([])
  const [sceneBaseline, setSceneBaseline] = useState('')
  const [scenesEdited, setScenesEdited] = useState(false)
  const [parsed, setParsed] = useState(false)
  const [editing, setEditing] = useState<Set<string>>(new Set())
  const [proposals, setProposals] = useState<Record<string, ScenePatch>>({})
  const [savingScenes, setSavingScenes] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [target, setTarget] = useState<'text' | 'scenes'>('text')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')

  // Page state
  const [loading, setLoading] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number } | null>(null)
  const [skipped, setSkipped] = useState(0)
  const parseEsRef = useRef<{ close(): void } | null>(null)

  const textDirty = text !== textBaseline
  const scenesDirty = JSON.stringify(scenes) !== sceneBaseline

  const loadScenes = useCallback(async () => {
    try {
      const s = await getChunkScenes(episodeId, chunkId)
      setScenes(s.scenes)
      setSceneBaseline(JSON.stringify(s.scenes))
      setScenesEdited(s.edited)
      setParsed(true)
    } catch (e) {
      if (/\b409\b/.test(String(e))) setParsed(false)
      else throw e
    }
  }, [episodeId, chunkId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getChunkText(episodeId, chunkId)
      .then(t => {
        if (!alive) return
        setText(t.text); setTextBaseline(t.text); setTextEdited(t.edited)
        setTextWordCount(t.word_count)
      })
      .then(() => loadScenes())
      .catch(() => { /* surfaced via empty/error states below */ })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [episodeId, chunkId, loadScenes])

  // Auto-follow target with parse state (still user-switchable).
  useEffect(() => { setTarget(parsed ? 'scenes' : 'text') }, [parsed])

  // Close any in-flight parse stream on unmount.
  useEffect(() => () => { parseEsRef.current?.close() }, [])

  // --- Text actions ---
  function acceptCorrection(c: TextCorrection) {
    setText(t => applyCorrection(t, c))
    setCorrections(cs => cs.filter(x => x !== c))
  }
  function rejectCorrection(c: TextCorrection) {
    setCorrections(cs => cs.filter(x => x !== c))
  }
  async function onSaveText() {
    setSavingText(true)
    try {
      const t = await saveText(episodeId, chunkId, text)
      setTextBaseline(t.text); setTextEdited(t.edited)
    } finally { setSavingText(false) }
  }
  async function onResetText() {
    if (!window.confirm('Discard your text edits and restore the original chapter text?')) return
    const t = await resetText(episodeId, chunkId)
    setText(t.text); setTextBaseline(t.text); setTextEdited(t.edited); setCorrections([])
  }

  // --- Parse ---
  async function onParse() {
    if (parsing) return
    if (parsed && !window.confirm('Re-parsing replaces the extracted scenes; saved scene edits will be discarded. Continue?')) return
    setParsing(true); setParseProgress(null)
    try {
      if (parsed && scenesEdited) await resetScenes(episodeId, chunkId).catch(() => {})
      const { run_id } = await parseEpisode(episodeId, [chunkId])
      const es = api.streamRun(run_id)
      parseEsRef.current = es
      es.addEventListener('message', (ev: Event) => {
        try {
          const event = JSON.parse((ev as MessageEvent).data as string)
          if (event.type === 'log') {
            const m = /\[(\d+)\/(\d+)\]/.exec(event.data.message)
            if (m) setParseProgress({ done: Number(m[1]), total: Number(m[2]) })
          }
          if (event.type === 'complete') {
            es.close(); parseEsRef.current = null; setParsing(false); setParseProgress(null)
            setProposals({}); loadScenes()
          }
          if (event.type === 'status' && event.data?.status === 'failed') {
            es.close(); parseEsRef.current = null; setParsing(false); setParseProgress(null)
          }
        } catch { /* ignore */ }
      })
    } catch { setParsing(false); setParseProgress(null) }
  }

  // --- Scene actions ---
  function saveLocalScene(next: PipelineScene) {
    setScenes(ss => ss.map(s => (s.scene_id === next.scene_id ? next : s)))
    setEditing(prev => { const n = new Set(prev); n.delete(next.scene_id); return n })
  }
  function acceptProposal(sceneId: string) {
    setProposals(prev => {
      const p = prev[sceneId]
      if (p) setScenes(ss => ss.map(s => (s.scene_id === sceneId ? { ...s, ...p.changes } : s)))
      const n = { ...prev }; delete n[sceneId]; return n
    })
  }
  function rejectProposal(sceneId: string) {
    setProposals(prev => { const n = { ...prev }; delete n[sceneId]; return n })
  }
  async function onSaveScenes() {
    setSavingScenes(true)
    try {
      const s = await saveScenes(episodeId, chunkId, scenes)
      setSceneBaseline(JSON.stringify(s.scenes)); setScenesEdited(s.edited)
    } finally { setSavingScenes(false) }
  }
  async function onResetScenes() {
    if (!window.confirm('Discard your scene edits and restore the original extraction?')) return
    const s = await resetScenes(episodeId, chunkId)
    setScenes(s.scenes); setSceneBaseline(JSON.stringify(s.scenes)); setScenesEdited(s.edited); setProposals({})
  }

  // --- Chat ---
  // Single send path: takes the full message list to POST. onSend appends the
  // user turn first; onRetry re-sends the existing list (the failed user turn is
  // still present, so nothing is re-appended) — avoids stale-closure bugs.
  async function sendMessages(msgs: ChatMessage[]) {
    setSending(true); setChatError(''); setSkipped(0)
    try {
      const res = await refineChat(episodeId, chunkId, msgs, target)
      setMessages([...msgs, { role: 'assistant', content: res.reply }])
      if (target === 'text' && res.corrections) {
        setCorrections(res.corrections)
      }
      if (target === 'scenes' && res.proposals) {
        const valid: Record<string, ScenePatch> = {}
        let skip = 0
        for (const p of res.proposals) {
          if (scenes.some(s => s.scene_id === p.scene_id)) valid[p.scene_id] = p
          else skip++
        }
        setProposals(valid); setSkipped(skip)
      }
    } catch (e) {
      setChatError(String(e))
    } finally { setSending(false) }
  }
  function onSend(content: string) {
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    sendMessages(next)
  }
  function onRetry() {
    if (messages.length > 0) sendMessages(messages)
  }

  return (
    <div className="max-w-6xl">
      <Link to={`/project/${id}/parse`} className="inline-flex items-center gap-1.5 text-xs text-steel hover:text-ink mb-4">
        ← Back to parsing
      </Link>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">{episodeId}</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">
        Chapter <span className="font-mono">{chunkId}</span>
      </h1>
      <p className="text-sm text-steel mt-1 mb-6">
        {textWordCount != null ? `${textWordCount.toLocaleString()} words` : 'Source text'}
        {parsed ? ` · ${scenes.length} scenes` : ''}
        {(textEdited || scenesEdited) ? ' · ✎ edited' : ''}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="min-w-0">
          <RawTextEditor
            text={text} edited={textEdited} dirty={textDirty} saving={savingText}
            parsed={parsed} parsing={parsing} parseProgress={parseProgress}
            corrections={corrections}
            onChange={setText}
            onAcceptCorrection={acceptCorrection} onRejectCorrection={rejectCorrection}
            onSave={onSaveText} onReset={onResetText} onParse={onParse}
          />

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-ink">Scenes</h2>
              {parsed && (
                <div className="flex items-center gap-2.5">
                  {scenesEdited && (
                    <button onClick={onResetScenes} className="text-xs text-steel hover:text-ink transition-colors">Reset</button>
                  )}
                  <button onClick={onSaveScenes} disabled={!scenesDirty || savingScenes}
                    className="px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    {savingScenes ? 'Saving…' : scenesDirty ? 'Save changes ●' : 'Saved'}
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <p className="text-xs text-steel py-4">Loading…</p>
            ) : !parsed ? (
              <div className="rounded-lg border border-dashed border-hairline bg-canvas p-6 text-center text-sm text-steel">
                This chapter hasn't been parsed yet.
                <div className="mt-1 text-xs text-stone">Use "Parse this chapter" above to extract scenes.</div>
              </div>
            ) : (
              <>
                {skipped > 0 && (
                  <div className="mb-2 text-[11px] text-stone">{skipped} suggestion(s) skipped (scene not found).</div>
                )}
                <div className="space-y-2.5">
                  {scenes.map(s => (
                    <EditableSceneCard
                      key={s.scene_id}
                      scene={s}
                      isEditing={editing.has(s.scene_id)}
                      proposal={proposals[s.scene_id]}
                      onEdit={() => setEditing(prev => new Set(prev).add(s.scene_id))}
                      onCancel={() => setEditing(prev => { const n = new Set(prev); n.delete(s.scene_id); return n })}
                      onSaveLocal={saveLocalScene}
                      onAcceptProposal={() => acceptProposal(s.scene_id)}
                      onRejectProposal={() => rejectProposal(s.scene_id)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-6 h-[70vh]">
          <RefineChat
            messages={messages} target={target} canTargetScenes={parsed}
            sending={sending} error={chatError}
            onSend={onSend} onChangeTarget={setTarget} onRetry={onRetry}
          />
        </div>
      </div>
    </div>
  )
}
