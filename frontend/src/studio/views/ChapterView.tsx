// frontend/src/studio/views/ChapterView.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getChunkScenes, getChunkText, parseEpisode,
  saveScenes, saveText, resetScenes, resetText, reparseScene, getSceneSource,
  type PipelineScene, type ScenePatch, type TextCorrection, type SceneSource,
} from '../../api/pipeline'
import { SpellCheck } from '../../spellcheck/SpellCheck'
import {
  streamChat, listSessions, createSession, getSession, renameSession, deleteSession,
  type ChatMention, type ChatUsage, type ChatSessionMeta,
} from '../../api/chat'
import { RefineChat, type ChatDisplayMessage } from '../../components/refine/RefineChat'
import { assistantTurn, storedToDisplay } from '../../components/refine/chatTurn'
import { api } from '../../api'
import { applyCorrection } from '../../components/refine/corrections'
import { RawTextEditor } from '../../components/refine/RawTextEditor'
import { EditableSceneCard } from '../../components/refine/EditableSceneCard'
import { SceneFocusPanel } from '../../components/refine/SceneFocusPanel'
import { EntityRegistryPanel } from '../../components/refine/EntityRegistryPanel'
import { VoiceProfilePanel } from '../../components/refine/VoiceProfilePanel'
import { applyParseEvent, initialParseStream, PHASE_LABEL, type ParseStreamState } from '../parseStream'
import type { RunEvent } from '../../types'

export function ChapterView() {
  const { id = '', episodeId = '', chunkId = '' } = useParams()

  // Text state
  const [text, setText] = useState('')
  const [textBaseline, setTextBaseline] = useState('')
  const [textEdited, setTextEdited] = useState(false)
  const [textWordCount, setTextWordCount] = useState<number | null>(null)
  const [savingText, setSavingText] = useState(false)
  const [corrections, setCorrections] = useState<TextCorrection[]>([])
  const [spellcheckOpen, setSpellcheckOpen] = useState(false)

  // Scenes state
  const [scenes, setScenes] = useState<PipelineScene[]>([])
  const [sceneBaseline, setSceneBaseline] = useState('')
  const [scenesEdited, setScenesEdited] = useState(false)
  const [parsed, setParsed] = useState(false)
  const [editing, setEditing] = useState<Set<string>>(new Set())
  const [proposals, setProposals] = useState<Record<string, ScenePatch>>({})
  const [savingScenes, setSavingScenes] = useState(false)
  const [reparsing, setReparsing] = useState<Set<string>>(new Set())
  const [reparseError, setReparseError] = useState('')
  const [focusedSceneId, setFocusedSceneId] = useState<string | null>(null)
  const [sceneSource, setSceneSource] = useState<{ loading: boolean; data: SceneSource | null; error: string }>(
    { loading: false, data: null, error: '' })

  // Chat state (server-authoritative sessions)
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([])
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamReply, setStreamReply] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [usage, setUsage] = useState<ChatUsage | null>(null)
  const [chatError, setChatError] = useState('')
  const chatAbortRef = useRef<{ abort(): void } | null>(null)
  const lastTurnRef = useRef<{ text: string; mentions: ChatMention } | null>(null)
  const streamReplyRef = useRef('')

  // Page state
  const [loading, setLoading] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number } | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [profilesRefresh, setProfilesRefresh] = useState(0)
  const [stream, setStream] = useState<ParseStreamState | null>(null)
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

  // Resume the latest session for this chunk on open.
  useEffect(() => {
    let alive = true
    listSessions(episodeId, chunkId).then(async list => {
      if (!alive) return
      setSessions(list)
      if (list.length > 0) {
        const { session, messages: stored } = await getSession(episodeId, chunkId, list[0].session_id)
        if (!alive) return
        setActiveSessionId(session.session_id)
        setMessages(stored.map(storedToDisplay))
        setUsage({ prompt_tokens: session.token_count, total_tokens: session.token_count, context_limit: 32768, skipped_mentions: [] })
      }
    }).catch(() => { /* no sessions yet */ })
    return () => { alive = false }
  }, [episodeId, chunkId])

  // Close any in-flight parse stream on unmount.
  useEffect(() => () => { parseEsRef.current?.close() }, [])

  // Abort any in-flight chat stream on unmount.
  useEffect(() => () => { chatAbortRef.current?.abort() }, [])

  // Fetch best-effort source location whenever a scene is focused.
  useEffect(() => {
    if (!focusedSceneId) return
    let alive = true
    setSceneSource({ loading: true, data: null, error: '' })
    getSceneSource(episodeId, chunkId, focusedSceneId)
      .then(data => { if (alive) setSceneSource({ loading: false, data, error: '' }) })
      .catch(e => { if (alive) setSceneSource({ loading: false, data: null, error: `Couldn't load source: ${String(e)}` }) })
    return () => { alive = false }
  }, [focusedSceneId, episodeId, chunkId])

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
    // Clear to skeletons: scenes + insight panels reset and reveal as events arrive.
    setParsing(true); setParseProgress(null); setStream(initialParseStream())
    try {
      if (parsed && scenesEdited) await resetScenes(episodeId, chunkId).catch(() => {})
      const { run_id } = await parseEpisode(episodeId, [chunkId])
      const es = api.streamRun(run_id)
      parseEsRef.current = es
      es.addEventListener('message', (ev: Event) => {
        try {
          const event = JSON.parse((ev as MessageEvent).data as string) as RunEvent
          if (event.type === 'complete') {
            es.close(); parseEsRef.current = null
            setParsing(false); setParseProgress(null); setStream(null)
            setProposals({}); loadScenes(); setProfilesRefresh(k => k + 1)  // reconcile + refresh panels
            return
          }
          if (event.type === 'status' && event.data?.status === 'failed') {
            es.close(); parseEsRef.current = null
            setParsing(false); setParseProgress(null); setStream(null)
            return
          }
          if (event.type === 'log') {
            const m = /\[(\d+)\/(\d+)\]/.exec(event.data.message ?? '')
            if (m) setParseProgress({ done: Number(m[1]), total: Number(m[2]) })
          }
          // Fold structured events into the progressive parse state.
          setStream(prev => (prev ? applyParseEvent(prev, event, chunkId) : prev))
        } catch { /* ignore malformed event */ }
      })
    } catch { setParsing(false); setParseProgress(null); setStream(null) }
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
  async function onReparseScene(sceneId: string) {
    setReparsing(prev => new Set(prev).add(sceneId))
    setReparseError('')
    try {
      const { scene } = await reparseScene(episodeId, chunkId, sceneId)
      const { scene_id, ...changes } = scene
      setProposals(prev => ({
        ...prev,
        [sceneId]: { scene_id: sceneId, changes, rationale: 'Re-parsed from source' },
      }))
    } catch (e) {
      setReparseError(`Re-parse failed: ${String(e)}`)
    } finally {
      setReparsing(prev => { const n = new Set(prev); n.delete(sceneId); return n })
    }
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

  // --- Chat (streaming, server-authoritative) ---
  async function refreshSessions() {
    try { setSessions(await listSessions(episodeId, chunkId)) } catch { /* ignore */ }
  }
  function runTurn(text: string, mentions: ChatMention) {
    lastTurnRef.current = { text, mentions }
    setMessages(m => [...m, { role: 'user', content: text }])
    streamReplyRef.current = ''
    setStreaming(true); setChatError(''); setStreamReply(''); setStreamThinking(''); setSkipped(0)
    let reply = ''
    let toolCount = 0
    let errored = false
    const handle = streamChat(
      episodeId, chunkId,
      { session_id: activeSessionId, message: text, thinking: thinkingEnabled, mentions },
      {
        onSession: id => setActiveSessionId(id),
        onTitle: () => { refreshSessions() },
        onThinking: d => setStreamThinking(t => t + d),
        onReply: d => { reply += d; streamReplyRef.current = reply; setStreamReply(reply) },
        onTool: (kind, payload) => {
          toolCount += 1
          if (kind === 'scene_edits') {
            const p = payload as ScenePatch
            if (scenes.some(s => s.scene_id === p.scene_id)) setProposals(prev => ({ ...prev, [p.scene_id]: p }))
            else setSkipped(n => n + 1)
          } else {
            const { corrections: cs } = payload as { corrections: TextCorrection[] }
            setCorrections(cs ?? [])
          }
        },
        onUsage: u => setUsage(u),
        onDone: () => {
          setStreaming(false)
          // A finished turn must never vanish: commit it even when the model
          // returned no prose (reasoning-only / tool-only / empty completion).
          // Skip only when the turn errored — onError already surfaced that and
          // the stream still closes, firing onDone.
          if (!errored) setMessages(m => [...m, assistantTurn(reply, toolCount)])
          setStreamReply(''); setStreamThinking('')
          refreshSessions()
        },
        onError: detail => { errored = true; setStreaming(false); setChatError(detail) },
      },
    )
    chatAbortRef.current = handle
  }
  function onSend(text: string, mentions: ChatMention) { if (!streaming) runTurn(text, mentions) }
  function onAbortChat() {
    chatAbortRef.current?.abort()
    const partial = streamReplyRef.current
    streamReplyRef.current = ''
    setStreaming(false)
    setMessages(m => partial ? [...m, { role: 'assistant', content: partial }] : m)
    setStreamReply(''); setStreamThinking('')
  }
  function onRetryChat() {
    const last = lastTurnRef.current
    if (!last) return
    setMessages(m => m[m.length - 1]?.role === 'user' ? m.slice(0, -1) : m)
    runTurn(last.text, last.mentions)
  }
  async function onNewChat() {
    chatAbortRef.current?.abort()
    setStreaming(false); setStreamReply(''); setStreamThinking(''); setChatError(''); setUsage(null)
    const s = await createSession(episodeId, chunkId)
    setActiveSessionId(s.session_id); setMessages([])
    refreshSessions()
  }
  async function onSelectSession(sessionId: string) {
    if (streaming) return
    const { session, messages: stored } = await getSession(episodeId, chunkId, sessionId)
    setActiveSessionId(session.session_id)
    setMessages(stored.map(storedToDisplay))
    setUsage({ prompt_tokens: session.token_count, total_tokens: session.token_count, context_limit: 32768, skipped_mentions: [] })
    setChatError('')
  }
  async function onRenameSession(sessionId: string, title: string) {
    await renameSession(episodeId, chunkId, sessionId, title)
    refreshSessions()
  }
  async function onDeleteSession(sessionId: string) {
    await deleteSession(episodeId, chunkId, sessionId)
    if (sessionId === activeSessionId) {
      const list = await listSessions(episodeId, chunkId)
      setSessions(list)
      if (list.length > 0) onSelectSession(list[0].session_id)
      else { setActiveSessionId(null); setMessages([]); setUsage(null) }
    } else {
      refreshSessions()
    }
  }

  const focusedScene = scenes.find(s => s.scene_id === focusedSceneId) ?? null
  const seedDraft = focusedScene
    ? `@Scene${(focusedScene.scene_id.match(/_S(\d+)$/)?.[1] ?? '').replace(/^0+(?=\d)/, '')} `
    : ''

  const chatEl = (
    <RefineChat
      messages={messages}
      streaming={streaming}
      streamReply={streamReply}
      streamThinking={streamThinking}
      thinkingEnabled={thinkingEnabled}
      usage={usage}
      error={chatError}
      sceneIds={scenes.map(s => s.scene_id)}
      seedDraft={seedDraft}
      sessions={sessions}
      activeSessionId={activeSessionId}
      onToggleThinking={() => setThinkingEnabled(v => !v)}
      onSend={onSend}
      onAbort={onAbortChat}
      onRetry={onRetryChat}
      onNewChat={onNewChat}
      onSelectSession={onSelectSession}
      onRenameSession={onRenameSession}
      onDeleteSession={onDeleteSession}
    />
  )

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
        {(textEdited || scenesEdited) ? ' · edited' : ''}
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
            onOpenSpellcheck={() => setSpellcheckOpen(true)}
          />

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-ink">Scenes</h2>
              {parsed && !stream && (
                <div className="flex items-center gap-2.5">
                  {scenesEdited && (
                    <button onClick={onResetScenes} className="text-xs text-steel hover:text-ink transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">Reset</button>
                  )}
                  <button onClick={onSaveScenes} disabled={!scenesDirty || savingScenes}
                    className="px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">
                    {savingScenes ? 'Saving…' : scenesDirty ? 'Save changes ●' : 'Saved'}
                  </button>
                </div>
              )}
              {stream && (
                <span className="text-[11px] text-[#3772cf] font-medium">{PHASE_LABEL[stream.phase]}</span>
              )}
            </div>

            {(loading || (stream !== null && !stream.scenesReceived)) ? (
              <div className="space-y-2.5" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-canvas border border-hairline rounded-md p-4 space-y-2.5 animate-pulse">
                    <div className="h-2.5 w-14 rounded-xs bg-hairline" />
                    <div className="h-3.5 w-3/4 rounded-xs bg-hairline" />
                    <div className="flex gap-1.5">
                      <div className="h-4 w-20 rounded-xs bg-hairline" />
                      <div className="h-4 w-16 rounded-xs bg-hairline" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !parsed && !stream ? (
              <div className="rounded-lg border border-dashed border-hairline bg-canvas p-6 text-center text-sm text-steel">
                This chapter hasn't been parsed yet.
                <div className="mt-1 text-xs text-stone">Use "Parse this chapter" above to extract scenes.</div>
              </div>
            ) : (
              <>
                {skipped > 0 && (
                  <div className="mb-2 text-[11px] text-stone">{skipped} suggestion(s) skipped (scene not found).</div>
                )}
                {reparseError && (
                  <div className="mb-2 text-[11px] text-brand-error">{reparseError}</div>
                )}
                <div className="space-y-2.5">
                  {(stream?.scenesReceived ? stream.scenes : scenes).map(s => (
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
                      onReparse={() => onReparseScene(s.scene_id)}
                      reparsing={reparsing.has(s.scene_id)}
                      onFocus={() => setFocusedSceneId(s.scene_id)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-6 h-[70vh]">
          {!focusedSceneId && chatEl}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink mb-1">Episode insights</h2>
        <p className="text-xs text-stone mb-3">Names &amp; voices span the whole episode, not just this chapter.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <EntityRegistryPanel
            episodeId={episodeId}
            refreshKey={profilesRefresh}
            liveStream={stream ? { active: true, characters: stream.characters, locations: stream.locations } : undefined}
          />
          <VoiceProfilePanel
            episodeId={episodeId}
            refreshKey={profilesRefresh}
            liveProfiles={stream ? stream.profiles : null}
          />
        </div>
      </section>

      {focusedScene && (
        <SceneFocusPanel
          scene={focusedScene}
          proposal={proposals[focusedScene.scene_id]}
          source={sceneSource}
          chapterText={text}
          onClose={() => setFocusedSceneId(null)}
          onEdit={() => { setEditing(prev => new Set(prev).add(focusedScene.scene_id)); setFocusedSceneId(null) }}
          onAcceptProposal={() => acceptProposal(focusedScene.scene_id)}
          onRejectProposal={() => rejectProposal(focusedScene.scene_id)}
        >
          {chatEl}
        </SceneFocusPanel>
      )}

      {spellcheckOpen && (
        <SpellCheck
          episodeId={episodeId}
          chunkId={chunkId}
          initialText={text}
          onApply={(corrected) => { setText(corrected); setSpellcheckOpen(false) }}
          onClose={() => setSpellcheckOpen(false)}
        />
      )}
    </div>
  )
}
