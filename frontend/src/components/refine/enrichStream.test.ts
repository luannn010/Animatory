import { describe, expect, it } from 'vitest'
import { applyEnrichEvent } from './enrichStream'
import type { EntityRegistry } from '../../api/pipeline'
import type { RunEvent } from '../../types'

const entityEvent = (kind: 'character' | 'location', entry: Record<string, unknown>): RunEvent =>
  ({ type: 'entity_described', run_id: 'r1', timestamp: '', data: { kind, entry } })

const reg = (): EntityRegistry => ({
  episode_id: 'ep1', updated_at: null,
  characters: [{ canonical: 'Từ An', aliases: [] }],
  locations: [{ canonical: 'Phòng', aliases: [] }],
})

describe('applyEnrichEvent', () => {
  it('replaces a character entry by canonical with the streamed entry', () => {
    const out = applyEnrichEvent(reg(), entityEvent('character', {
      canonical: 'Từ An', aliases: [], description: { summary: 's', appearance: 'lean' },
    }))
    expect(out.characters).toHaveLength(1)  // upsert, not duplicate
    expect((out.characters[0].description as { appearance: string }).appearance).toBe('lean')
  })

  it('routes location entries to the locations list and leaves characters alone', () => {
    const out = applyEnrichEvent(reg(), entityEvent('location', {
      canonical: 'Phòng', aliases: [], description: { setting: 'silk' },
    }))
    expect((out.locations[0].description as { setting: string }).setting).toBe('silk')
    expect(out.characters[0].description).toBeUndefined()
  })

  it('appends a streamed entity that is not already in the list', () => {
    const out = applyEnrichEvent(reg(), entityEvent('character', { canonical: 'Lan Nhi', aliases: [] }))
    expect(out.characters.map(c => c.canonical)).toEqual(['Từ An', 'Lan Nhi'])
  })

  it('returns the same registry for non-entity events and malformed entries', () => {
    const r0 = reg()
    const log: RunEvent = { type: 'log', run_id: 'r', timestamp: '', data: { message: 'x' } }
    expect(applyEnrichEvent(r0, log)).toBe(r0)
    const noEntry: RunEvent = { type: 'entity_described', run_id: 'r', timestamp: '', data: { kind: 'character' } }
    expect(applyEnrichEvent(r0, noEntry)).toBe(r0)
  })
})
