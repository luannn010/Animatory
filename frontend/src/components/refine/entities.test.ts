// frontend/src/components/refine/entities.test.ts
import { describe, it, expect } from 'vitest'
import { parseAliases, formatAliases } from './entities'

describe('parseAliases', () => {
  it('splits on commas and newlines, trims, drops blanks + dups', () => {
    expect(parseAliases('đại cản, Dai Can\n đại cản ,, ')).toEqual(['đại cản', 'Dai Can'])
  })
  it('returns empty array for empty input', () => {
    expect(parseAliases('   ')).toEqual([])
  })
})

describe('formatAliases', () => {
  it('joins with comma-space', () => {
    expect(formatAliases(['a', 'b'])).toBe('a, b')
  })
})
