import { describe, it, expect } from 'vitest'
import { initialState, reduce } from './useSpellCheckWS'

describe('spellcheck ws reducer', () => {
  it('tracks progress on chunk_started', () => {
    const s = reduce(initialState, { type: 'chunk_started', chunk_index: 0, total_chunks: 6 })
    expect(s.totalChunks).toBe(6)
    expect(s.startedChunks).toBe(1)
  })

  it('appends findings with ids, dropping overlaps', () => {
    let s = reduce(initialState, { type: 'chunk_started', chunk_index: 0, total_chunks: 1 })
    s = reduce(s, {
      type: 'chunk_findings', chunk_index: 0, findings: [
        { type: 'spelling', original: 'teh', suggestion: 'the', char_start: 0, char_end: 3, reason: '' },
        { type: 'spelling', original: 'eh d', suggestion: 'x', char_start: 1, char_end: 5, reason: '' }, // overlaps -> dropped
      ],
    })
    expect(s.findings).toHaveLength(1)
    expect(s.findings[0].id).toBeTruthy()
    expect(s.findings[0].status).toBe('pending')
  })

  it('marks done on complete', () => {
    const s = reduce(initialState, { type: 'complete', total_findings: 3 })
    expect(s.done).toBe(true)
  })

  it('records per-chunk errors without stopping', () => {
    const s = reduce(initialState, { type: 'error', chunk_index: 2, message: 'boom' })
    expect(s.errors).toEqual([{ chunk_index: 2, message: 'boom' }])
  })
})
