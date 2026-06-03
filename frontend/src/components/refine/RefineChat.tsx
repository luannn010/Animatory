// frontend/src/components/refine/RefineChat.tsx
import { useState } from 'react'
import type { ChatMessage } from '../../api/pipeline'

interface Props {
  messages: ChatMessage[]
  target: 'text' | 'scenes'
  canTargetScenes: boolean
  sending: boolean
  error: string
  onSend: (text: string) => void
  onChangeTarget: (t: 'text' | 'scenes') => void
  onRetry: () => void
}

export function RefineChat({
  messages, target, canTargetScenes, sending, error, onSend, onChangeTarget, onRetry,
}: Props) {
  const [draft, setDraft] = useState('')

  function submit() {
    const text = draft.trim()
    if (!text || sending) return
    onSend(text)
    setDraft('')
  }

  return (
    <div className="flex flex-col h-full rounded-lg border border-hairline bg-canvas">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
        <h2 className="text-sm font-semibold text-ink">Refine</h2>
        <div className="flex rounded-full border border-hairline overflow-hidden text-[11px]">
          {(['text', 'scenes'] as const).map(t => {
            const disabled = t === 'scenes' && !canTargetScenes
            const active = target === t
            return (
              <button
                key={t}
                type="button"
                disabled={disabled || sending}
                onClick={() => onChangeTarget(t)}
                className={
                  'px-2.5 py-1 capitalize transition-colors disabled:opacity-40 ' +
                  (active ? 'bg-[#3772cf] text-white' : 'text-steel hover:text-ink')
                }
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <p className="text-xs text-stone leading-relaxed">
            {target === 'text'
              ? 'Ask me to scan for typos or fix a character’s name across the chapter.'
              : 'Ask me to refine these scenes — e.g. “make scene 3 darker”.'}
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user' ? 'text-right' : 'text-left'}
            >
              <span
                className={
                  'inline-block rounded-md px-3 py-2 text-xs leading-snug max-w-[85%] text-left ' +
                  (m.role === 'user'
                    ? 'bg-[#3772cf] text-white'
                    : 'bg-surface text-ink border border-hairline')
                }
              >
                {m.content}
              </span>
            </div>
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-steel">
            <Spinner /> Thinking…
          </div>
        )}
        {error && (
          <div className="text-xs text-brand-error">
            {error}{' '}
            <button onClick={onRetry} className="underline hover:text-ink">Retry</button>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
            rows={2}
            placeholder={target === 'text' ? 'Ask to fix text…' : 'Ask to refine scenes…'}
            className="flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink placeholder:text-stone focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || sending}
            className="px-3 py-2 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
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
