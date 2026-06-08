import { describe, it, expect } from 'vitest'
import type { Finding } from './types'
import { applyOne, applyAll, dropOverlaps, verify } from './offsets'

function f(partial: Partial<Finding> & { char_start: number; char_end: number; original: string; suggestion: string }): Finding {
  return {
    id: partial.id ?? `${partial.char_start}`,
    type: partial.type ?? 'spelling',
    reason: partial.reason ?? '',
    status: partial.status ?? 'pending',
    ...partial,
  }
}

describe('verify', () => {
  it('is true only when slice equals original', () => {
    const text = 'the protagnist arrived'
    expect(verify(text, f({ char_start: 4, char_end: 14, original: 'protagnist', suggestion: 'protagonist' }))).toBe(true)
    expect(verify(text, f({ char_start: 0, char_end: 3, original: 'XXX', suggestion: 'x' }))).toBe(false)
  })
})

describe('applyOne — length-changing replace shifts later findings', () => {
  it('a later finding still lands on the correct characters', () => {
    const text = 'the protagnist met teh dog'
    const findings = [
      f({ id: 'a', char_start: 4, char_end: 14, original: 'protagnist', suggestion: 'protagonist' }), // +1
      f({ id: 'b', char_start: 19, char_end: 22, original: 'teh', suggestion: 'the' }),
    ]
    const r1 = applyOne(text, findings, 'a')
    expect(r1.text).toBe('the protagonist met teh dog')
    const b = r1.findings.find(x => x.id === 'b')!
    expect(b.char_start).toBe(20) // shifted by +1
    expect(r1.text.slice(b.char_start, b.char_end)).toBe('teh')
    const r2 = applyOne(r1.text, r1.findings, 'b')
    expect(r2.text).toBe('the protagonist met the dog')
  })

  it('honors a suggestion override', () => {
    const text = 'teh dog'
    const findings = [f({ id: 'a', char_start: 0, char_end: 3, original: 'teh', suggestion: 'the' })]
    const r = applyOne(text, findings, 'a', 'THE')
    expect(r.text).toBe('THE dog')
  })
})

describe('applyAll — back-to-front, no off-by-one', () => {
  it('applies every pending finding correctly', () => {
    const text = 'teh protagnist and teh hero'
    const findings = [
      f({ id: 'a', char_start: 0, char_end: 3, original: 'teh', suggestion: 'the' }),
      f({ id: 'b', char_start: 4, char_end: 14, original: 'protagnist', suggestion: 'protagonist' }),
      f({ id: 'c', char_start: 19, char_end: 22, original: 'teh', suggestion: 'the' }),
    ]
    const r = applyAll(text, findings)
    expect(r.text).toBe('the protagonist and the hero')
    expect(r.findings.every(x => x.status === 'applied')).toBe(true)
  })
})

describe('stale handling', () => {
  it('marks a finding stale instead of corrupting when slice !== original', () => {
    const text = 'completely different text'
    const findings = [f({ id: 'a', char_start: 0, char_end: 3, original: 'teh', suggestion: 'the' })]
    const r = applyOne(text, findings, 'a')
    expect(r.text).toBe(text) // unchanged
    expect(r.findings.find(x => x.id === 'a')!.status).toBe('stale')
  })

  it('relocates when original moved but is still present nearby', () => {
    const text = 'x teh dog' // original shifted right by 2 vs expected offset 0
    const findings = [f({ id: 'a', char_start: 0, char_end: 3, original: 'teh', suggestion: 'the' })]
    const r = applyOne(text, findings, 'a')
    expect(r.text).toBe('x the dog')
  })
})

describe('dropOverlaps', () => {
  it('keeps the first in document order, drops overlappers', () => {
    const findings = [
      f({ id: 'a', char_start: 0, char_end: 5, original: 'hello', suggestion: 'Hello' }),
      f({ id: 'b', char_start: 3, char_end: 8, original: 'lo wo', suggestion: 'x' }), // overlaps a
      f({ id: 'c', char_start: 10, char_end: 13, original: 'cat', suggestion: 'dog' }),
    ]
    const kept = dropOverlaps(findings)
    expect(kept.map(x => x.id)).toEqual(['a', 'c'])
  })
})
