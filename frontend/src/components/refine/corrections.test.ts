// frontend/src/components/refine/corrections.test.ts
import { describe, it, expect } from 'vitest'
import { applyCorrection, correctionMatches } from './corrections'

describe('corrections', () => {
  it('replaces first occurrence when all_occurrences is false', () => {
    const out = applyCorrection('teh cat teh dog', { find: 'teh', replace: 'the', rationale: '', all_occurrences: false })
    expect(out).toBe('the cat teh dog')
  })

  it('replaces every occurrence when all_occurrences is true', () => {
    const out = applyCorrection('Tú Ân and Tú Ân', { find: 'Tú Ân', replace: 'Tú An', rationale: '', all_occurrences: true })
    expect(out).toBe('Tú An and Tú An')
  })

  it('correctionMatches is false when find is absent', () => {
    expect(correctionMatches('hello', { find: 'xyz', replace: '', rationale: '', all_occurrences: false })).toBe(false)
  })
})
