// frontend/src/components/refine/RefineChat.tsx
import { useMemo, useState } from 'react'
import type { ChatMention, ChatUsage, ChatSessionMeta } from '../../api/chat'
import { parseMentions } from './mentions'

export interface ChatDisplayMessage {
  role: 'user' | 'assistant'
  content: string
  toolCount?: number
}

interface Props {
  messages: ChatDisplayMessage[]
  streaming: boolean
  streamReply: string
  streamThinking: string
  thinkingEnabled: boolean
  usage: ChatUsage | null
  error: string
  sceneIds: string[]
  sessions: ChatSessionMeta[]
  activeSessionId: string | null
  onToggleThinking: () => void
  onSend: (text: string, mentions: ChatMention) => void
  onAbort: () => void
  onRetry: () => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
}

export function RefineChat(props: Props) {
  const {
    messages, streaming, streamReply, streamThinking, thinkingEnabled, usage, error,
    sceneIds, sessions, activeSessionId, onToggleThinking, onSend, onAbort, onRetry,
    onNewChat, onSelectSession, onRenameSession, onDeleteSession,
  } = props
  const [draft, setDraft] = useState('')
  const [showThoughts, setShowThoughts] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const activeTitle = sessions.find(s => s.session_id === activeSessionId)?.title ?? 'New chat'

  const trailing = /(^|\s)@(\w*)$/.exec(draft)
  const suggestions = useMemo(() => {
    if (!trailing) return [] as string[]
    const q = trailing[2].toLowerCase()
    const opts = ['raw', ...sceneIds.map((_, i) => `Scene${String(i + 1).padStart(2, '0')}`)]
    return opts.filter(o => o.toLowerCase().startsWith(q)).slice(0, 6)
  }, [trailing, sceneIds])

  function applySuggestion(s: string) { setDraft(d => d.replace(/@(\w*)$/, `@${s} `)) }
  function submit() {
    const text = draft.trim()
    if (!text || streaming) return
    if (text === '/clear') { onNewChat(); setDraft(''); return }
    onSend(text, parseMentions(text, sceneIds))
    setDraft('')
  }
  function startRename(s: ChatSessionMeta) { setRenamingId(s.session_id); setRenameDraft(s.title ?? '') }
  function commitRename() {
    if (renamingId && renameDraft.trim()) onRenameSession(renamingId, renameDraft.trim())
    setRenamingId(null)
  }

  const pct = usage && usage.context_limit > 0
    ? Math.min(100, Math.round((usage.prompt_tokens / usage.context_limit) * 100)) : 0
  const ctrl = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

  return (
    <div className="flex flex-col h-full rounded-lg border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
        <button
          type="button"
          onClick={() => setHistoryOpen(o => !o)}
          className={`flex items-center gap-1.5 text-sm font-semibold text-ink rounded-md transition-colors hover:text-steel ${ctrl}`}
        >
          {activeTitle}
          <span className="text-stone text-[10px]">{historyOpen ? '▲' : '▼'}</span>
        </button>
        <div className="flex items-center gap-3">
          {usage && <ContextRing pct={pct} label={`${usage.prompt_tokens} / ${usage.context_limit}`} />}
          <button type="button" onClick={onToggleThinking} disabled={streaming}
            className={`text-[11px] rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${ctrl} ` +
              (thinkingEnabled ? 'border-[#3772cf] text-[#3772cf]' : 'border-hairline text-steel hover:text-ink')}>
            Thinking {thinkingEnabled ? 'on' : 'off'}
          </button>
          <button type="button" onClick={onNewChat} disabled={streaming}
            className={`text-[11px] text-steel hover:text-ink disabled:opacity-40 transition-colors rounded-md ${ctrl}`}>
            New chat
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="border-b border-hairline max-h-48 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-stone">No saved chats yet.</p>
          ) : sessions.map(s => (
            <div key={s.session_id}
              className={'flex items-center gap-2 px-4 py-2 text-xs border-b border-hairline last:border-b-0 ' +
                (s.session_id === activeSessionId ? 'bg-surface' : '')}>
              {renamingId === s.session_id ? (
                <input autoFocus value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                  onBlur={commitRename}
                  className={`flex-1 rounded-md border border-hairline bg-canvas px-2 py-1 text-ink ${ctrl}`} />
              ) : (
                <button type="button" disabled={streaming}
                  onClick={() => { onSelectSession(s.session_id); setHistoryOpen(false) }}
                  className={`flex-1 text-left truncate hover:text-ink transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${ctrl} ` +
                    (s.session_id === activeSessionId ? 'text-ink font-medium' : 'text-steel')}>
                  {s.title ?? 'Untitled'} <span className="text-stone">· {s.message_count} msg</span>
                </button>
              )}
              <button type="button" onClick={() => startRename(s)} aria-label="Rename chat" disabled={streaming}
                className={`text-stone hover:text-ink transition-colors rounded-md px-1 disabled:opacity-50 disabled:cursor-not-allowed ${ctrl}`}>Rename</button>
              <button type="button" disabled={streaming}
                onClick={() => { if (window.confirm('Delete this chat?')) onDeleteSession(s.session_id) }}
                aria-label="Delete chat"
                className={`text-stone hover:text-brand-error transition-colors rounded-md px-1 disabled:opacity-50 disabled:cursor-not-allowed ${ctrl}`}>Delete</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !streaming ? (
          <p className="text-xs text-stone leading-relaxed">
            Ask about this chapter, or request a change. Tag context with <code className="text-steel">@Scene1</code> or <code className="text-steel">@raw</code>.
          </p>
        ) : (
          messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} toolCount={m.toolCount} />)
        )}
        {streaming && (
          <div className="space-y-2">
            {thinkingEnabled && streamThinking && (
              <div className="rounded-md border border-hairline bg-surface">
                <button onClick={() => setShowThoughts(s => !s)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] text-steel hover:text-ink transition-colors rounded-md ${ctrl}`}>
                  {showThoughts ? '▾' : '▸'} Thinking…
                </button>
                {showThoughts && (
                  <pre className="px-3 pb-2 text-[11px] text-stone whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{streamThinking}</pre>
                )}
              </div>
            )}
            <Bubble role="assistant" content={streamReply || '…'} />
          </div>
        )}
        {error && (
          <div className="text-xs text-brand-error">
            {error}{' '}
            <button onClick={onRetry} className={`underline hover:text-ink rounded-md ${ctrl}`}>Retry</button>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        {suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => applySuggestion(s)}
                className={`rounded-full border border-hairline px-2 py-0.5 text-[11px] text-steel hover:text-ink hover:border-[#3772cf] transition-colors ${ctrl}`}>
                @{s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={2} placeholder="Ask, request a change, or /clear… (@Scene1, @raw)"
            className={`flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink placeholder:text-stone ${ctrl}`} />
          {streaming ? (
            <button type="button" onClick={onAbort}
              className={`px-3 py-2 rounded-md border border-hairline text-steel text-xs hover:bg-surface transition-colors ${ctrl}`}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!draft.trim()}
              className={`px-3 py-2 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${ctrl}`}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, content, toolCount }: { role: 'user' | 'assistant'; content: string; toolCount?: number }) {
  return (
    <div className={role === 'user' ? 'text-right' : 'text-left'}>
      <span className={
        'inline-block rounded-md px-3 py-2 text-xs leading-snug max-w-[85%] text-left whitespace-pre-wrap ' +
        (role === 'user' ? 'bg-[#3772cf] text-white' : 'bg-surface text-ink border border-hairline')
      }>
        {content}
      </span>
      {role === 'assistant' && toolCount ? (
        <div className="text-[10px] text-stone mt-0.5">proposed {toolCount} edit{toolCount === 1 ? '' : 's'}</div>
      ) : null}
    </div>
  )
}

function ContextRing({ pct, label }: { pct: number; label: string }) {
  const r = 7, c = 2 * Math.PI * r
  const danger = pct >= 90
  return (
    <span title={`Context: ${label}`} className="inline-flex items-center" aria-label={`Context ${pct}%`}>
      <svg viewBox="0 0 18 18" className="w-4 h-4 -rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-hairline" />
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          stroke={danger ? '#d45656' : '#3772cf'} strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
    </span>
  )
}
