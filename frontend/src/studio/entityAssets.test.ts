import { describe, it, expect } from 'vitest'
import { slug, composePrompt, mapEntities } from './entityAssets'
import type { EntityRegistry } from '../api/pipeline'

describe('slug', () => {
  it('strips diacritics and lowercases to a url-safe id', () => {
    expect(slug('Từ An')).toBe('tu-an')
    expect(slug('Phòng công chúa')).toBe('phong-cong-chua')
  })
  it('falls back to a stable token for empty input', () => {
    expect(slug('  ')).toBe('entity')
  })
})

describe('composePrompt', () => {
  it('joins character description fields, skipping empties', () => {
    const out = composePrompt('character', {
      summary: 'a young censor', appearance: 'lean', attire: '', age_build: 'young', palette: '',
    })
    expect(out).toBe('a young censor. lean. young')
  })
  it('appends location time-of-day variants', () => {
    const out = composePrompt('location', {
      summary: 'a silk chamber', setting: 'silk drapes', lighting: 'candlelit', time_variants: ['night'],
    })
    expect(out).toContain('silk drapes')
    expect(out).toContain('Times of day: night.')
  })
  it('returns empty string when there is no description', () => {
    expect(composePrompt('character', null)).toBe('')
  })
})

describe('mapEntities', () => {
  const registry: EntityRegistry = {
    episode_id: 'ep1', updated_at: null,
    characters: [{ canonical: 'Từ An', aliases: [], description: { summary: 'a censor', appearance: 'lean', attire: '', age_build: '', palette: '' } }],
    locations: [{ canonical: 'Phòng', aliases: [], description: { summary: '', setting: 'silk', lighting: 'dim', time_variants: [] } }],
  }

  it('maps characters and locations to DesignAssets', () => {
    const assets = mapEntities(registry, 'ep01')
    expect(assets).toHaveLength(2)
    const char = assets.find(a => a.kind === 'character')!
    expect(char.id).toBe('tu-an')
    expect(char.displayName).toBe('Từ An')
    expect(char.stage).toBe('rough')
    expect(char.candidates).toEqual([])
    expect(char.promptText).toContain('a censor')
    expect(char.summary).toBe('a censor')
    const loc = assets.find(a => a.kind === 'location')!
    expect(loc.id).toBe('phong')
    expect(loc.promptText).toContain('silk')
  })
})
