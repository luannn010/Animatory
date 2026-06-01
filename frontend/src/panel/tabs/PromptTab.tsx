import { useState } from 'react'
import type { AgentSchema } from '../../types'

interface Props { agent: AgentSchema }

function HighlightedPrompt({ text }: { text: string }) {
  const parts = text.split(/({{[^}]+}})/)
  return (
    <span>
      {parts.map((part, i) =>
        /^{{.+}}$/.test(part)
          ? <mark key={i} className="bg-[#E0A800]/20 text-[#b88400] rounded px-0.5 not-italic">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </span>
  )
}

const DEFAULT_PROMPT: Record<string, string> = {
  'orch.showrunner':   'You are the showrunner for {{episode_title}}.\n\nBreak down the script into scenes, characters, and assets.\n\nScript:\n{{final_script}}',
  'board.storyboard':  'Generate a storyboard breakdown for scene {{scene_id}} of episode {{episode_title}}.\n\nBreakdown:\n{{breakdown}}',
}

export function PromptTab({ agent }: Props) {
  const initial = DEFAULT_PROMPT[agent.id] ?? `You are ${agent.name}.\n\nContext:\n{{context}}`
  const [prompt, setPrompt] = useState(initial)
  const [editing, setEditing] = useState(false)

  const placeholders = [...new Set([...prompt.matchAll(/{{([^}]+)}}/g)].map(m => m[1]))]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel">System Prompt</p>
        <button
          onClick={() => setEditing(e => !e)}
          className="text-xs text-steel hover:text-ink transition-colors"
        >
          {editing ? 'Preview' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="w-full h-48 font-mono text-xs text-charcoal bg-surface border border-hairline rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-[#00d4a4]"
        />
      ) : (
        <pre className="font-mono text-xs text-charcoal bg-surface border border-hairline rounded-lg p-3 whitespace-pre-wrap leading-relaxed overflow-auto max-h-48">
          <HighlightedPrompt text={prompt} />
        </pre>
      )}

      {placeholders.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Placeholders</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-stone text-left border-b border-hairline">
                <th className="pb-1 font-medium">Name</th>
                <th className="pb-1 font-medium">Resolved from</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/50">
              {placeholders.map(p => (
                <tr key={p}>
                  <td className="py-1.5 font-mono text-[#b88400]">{`{{${p}}}`}</td>
                  <td className="py-1.5 text-stone">context.{p}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
