import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentSchema } from '../types'
import { api } from '../api'

interface Props {
  agent: AgentSchema
  onClose: () => void
}

export function RunTriggerPanel({ agent, onClose }: Props) {
  const navigate = useNavigate()
  const [systemPrompt, setSystemPrompt] = useState('')
  const [contextValues, setContextValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const context: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(contextValues)) context[k] = v
      const { run_id } = await api.triggerRun(agent.id, { context, system_prompt: systemPrompt })
      navigate(`/runs/${run_id}/monitor`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-canvas rounded-lg border border-hairline shadow-card w-full max-w-xl mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="px-6 py-4 flex items-center justify-between border-b border-hairline"
          style={{ background: 'linear-gradient(135deg, #1a3d4a 0%, #2d5a4f 100%)' }}
        >
          <div>
            <p className="text-xs font-mono text-[#b3b3b3]">Trigger run</p>
            <h2 className="text-base font-semibold text-white">{agent.name}</h2>
          </div>
          <button onClick={onClose} className="text-[#b3b3b3] text-xl leading-none px-2">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-steel">Context Inputs</p>
            {agent.inputs.map(io => (
              <div key={io.name}>
                <label className="block text-sm text-charcoal mb-1 font-mono">
                  {io.name}
                  <span className="ml-2 text-xs text-stone">({io.type})</span>
                  {io.required && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[#d45656]">required</span>}
                </label>
                <input
                  type="text"
                  placeholder={`Enter ${io.name}...`}
                  value={contextValues[io.name] ?? ''}
                  onChange={e => setContextValues(prev => ({ ...prev, [io.name]: e.target.value }))}
                  className="w-full h-10 px-4 rounded-md border border-hairline bg-canvas text-ink text-sm focus:outline-none focus:ring-2 focus:ring-[#00d4a4]"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">
              System Prompt
            </label>
            <textarea
              rows={4}
              placeholder="Override the agent's system prompt (optional)..."
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="w-full px-4 py-3 rounded-md border border-hairline bg-canvas text-ink text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#00d4a4]"
            />
          </div>

          {error && (
            <p className="text-sm text-[#d45656] bg-[#d45656]/10 px-4 py-3 rounded-md border border-[#d45656]/30">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-full border border-hairline text-sm text-ink font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-full bg-[#00d4a4] text-ink text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Starting…' : 'Start Run →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
