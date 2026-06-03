// frontend/src/components/refine/RefineChat.tsx
import { useMemo, useState } from 'react'
import type { ChatMessage } from '../../api/pipeline'
import type { ChatMention, ChatUsage } from '../../api/chat'
import { parseMentions } from './mentions'

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  streamReply: string
  streamThinking: string
  thinkingEnabled: boolean
  usage: ChatUsage | null
  error: string
  sceneIds: string[]
  onToggleThinking: () => void
  onSend: (text: string, mentions: ChatMention) => void
  onAbort: () => void
  onRetry: () => void
  onNewChat: () => void
}

export function RefineChat(props: Props) {
  const {
    messages, streaming, streamReply, streamThinking, thinkingEnabled, usage, error,
    sceneIds, onToggleThinking, onSend, onAbort, onRetry, onNewChat,
  } = props
  const [draft, setDraft] = useState('')
  const [showThoughts, setShowThoughts] = useState(true)

  const trailing = /(^|\s)@(\w*)$/.exec(draft)
  const suggestions = useMemo(() => {
    if (!trailing) return [] as string[]
    const q = trailing[2].toLowerCase()
    const opts = ['raw', ...sceneIds.map((_, i) => `Scene${String(i + 1).padStart(2, '0')}`)]
    return opts.filter(o => o.toLowerCase().startsWith(q)).slice(0, 6)
  }, [trailing, sceneIds])

  function applySuggestion(s: string) {
    setDraft(d => d.replace(/@(\w*)$/, `@${s} `))
  }
  function submit() {
    const text = draft.trim()
    if (!text || streaming) return
    onSend(text, parseMentions(text, sceneIds))
    setDraft('')
  }

  const pct = usage && usage.context_limit > 0
    ? Math.min(100, Math.round((usage.prompt_tokens / usage.context_limit) * 100)) : 0

  return (
    <div className="flex flex-col h-full rounded-lg border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
        <h2 className="text-sm font-semibold text-ink">Refine</h2>
        <div className="flex items-center gap-3">
          {usage && <ContextRing pct={pct} label={`${usage.prompt_tokens} / ${usage.context_limit}`} />}
          <button
            type="button"
            onClick={onToggleThinking}
            disabled={streaming}
            className={
              'text-[11px] rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] ' +
              (thinkingEnabled ? 'border-[#3772cf] text-[#3772cf]' : 'border-hairline text-steel hover:text-ink')
            }
          >
            Thinking {thinkingEnabled ? 'on' : 'off'}
          </button>
          <button type="button" onClick={onNewChat} disabled={streaming}
            className="text-[11px] text-steel hover:text-ink disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded-md">
            New chat
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !streaming ? (
          <p className="text-xs text-stone leading-relaxed">
            Ask about this chapter, or request a change. Tag context with <code className="text-steel">@Scene1</code> or <code className="text-steel">@raw</code>.
          </p>
        ) : (
          messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)
        )}

        {streaming && (
          <div className="space-y-2">
            {thinkingEnabled && streamThinking && (
              <div className="rounded-md border border-hairline bg-surface">
                <button onClick={() => setShowThoughts(s => !s)}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-steel hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded-t-md">
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
            <button onClick={onRetry} className="underline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded">Retry</button>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        {suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => applySuggestion(s)}
                className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-steel hover:text-ink hover:border-[#3772cf] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">
                @{s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={2}
            placeholder="Ask or request a change… (@Scene1, @raw)"
            className="flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink placeholder:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          />
          {streaming ? (
            <button type="button" onClick={onAbort}
              className="px-3 py-2 rounded-md border border-hairline text-steel text-xs hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">
              Stop
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!draft.trim()}
              className="px-3 py-2 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]">
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, content }: { role: ChatMessage['role']; content: string }) {
  return (
    <div className={role === 'user' ? 'text-right' : 'text-left'}>
      <span className={
        'inline-block rounded-md px-3 py-2 text-xs leading-snug max-w-[85%] text-left whitespace-pre-wrap ' +
        (role === 'user' ? 'bg-[#3772cf] text-white' : 'bg-surface text-ink border border-hairline')
      }>
        {content}
      </span>
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
          stroke={danger ? '#d45656' : '#3772cf'}
          strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
    </span>
  )
}
