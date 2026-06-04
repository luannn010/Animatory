import type { ChatDisplayMessage } from './RefineChat'
import type { StoredMessage } from '../../api/chat'

/**
 * Build the assistant turn to commit when a chat stream finishes.
 *
 * A completed turn must never silently vanish. When the model returns no prose
 * `content` — a reasoning-only completion, a tool-call-only turn, or an empty
 * completion — we still surface a turn so the user can see the request resolved
 * (otherwise the streaming bubble clears and nothing is left behind, which reads
 * as "request done but nothing rendered"). The `toolCount` footnote carries the
 * "proposed N edits" detail.
 */
export function assistantTurn(reply: string, toolCount: number): ChatDisplayMessage {
  const content = reply.trim()
    ? reply
    : toolCount > 0
      ? 'Proposed changes.'
      : 'No response.'
  return { role: 'assistant', content, toolCount }
}

/** Map a persisted message to a display message, using the same empty-turn
 *  fallback as live turns so a reloaded session matches what was shown live. */
export function storedToDisplay(m: StoredMessage): ChatDisplayMessage {
  return m.role === 'assistant'
    ? assistantTurn(m.content, m.tool_calls.length)
    : { role: 'user', content: m.content }
}
