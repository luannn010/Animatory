import { describe, it, expect } from 'vitest'
import { assistantTurn, storedToDisplay } from './chatTurn'

describe('assistantTurn', () => {
  it('keeps a prose reply as-is', () => {
    expect(assistantTurn('Hello there', 0)).toEqual({
      role: 'assistant', content: 'Hello there', toolCount: 0,
    })
  })

  it('does not vanish on a tool-only turn (no prose reply)', () => {
    const t = assistantTurn('', 2)
    expect(t.role).toBe('assistant')
    expect(t.content).not.toBe('')
    expect(t.toolCount).toBe(2)
  })

  it('shows a placeholder on an empty completion with no tools', () => {
    expect(assistantTurn('', 0).content).toBe('No response.')
  })

  it('treats a whitespace-only reply as empty', () => {
    expect(assistantTurn('   \n ', 0).content).toBe('No response.')
  })
})

describe('storedToDisplay', () => {
  it('maps a user message verbatim', () => {
    expect(
      storedToDisplay({ id: 1, role: 'user', content: 'hi', tool_calls: [], created_at: '' }),
    ).toEqual({ role: 'user', content: 'hi' })
  })

  it('applies the same fallback to a stored empty assistant turn', () => {
    const d = storedToDisplay({
      id: 2, role: 'assistant', content: '',
      tool_calls: [{ kind: 'scene_edits', payload: {} }], created_at: '',
    })
    expect(d.content).toBe('Proposed changes.')
    expect(d.toolCount).toBe(1)
  })

  it('keeps a stored assistant message that has prose', () => {
    const d = storedToDisplay({
      id: 3, role: 'assistant', content: 'Done.', tool_calls: [], created_at: '',
    })
    expect(d).toEqual({ role: 'assistant', content: 'Done.', toolCount: 0 })
  })
})
