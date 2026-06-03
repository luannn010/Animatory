// frontend/src/components/refine/mentions.test.ts
import { describe, it, expect } from 'vitest'
import { parseMentions } from './mentions'

const IDS = ['C001_S01', 'C001_S02', 'C001_S03']

describe('parseMentions', () => {
  it('resolves @SceneN to the current chunk scene id', () => {
    expect(parseMentions('look at @Scene2 please', IDS)).toEqual({ scenes: ['C001_S02'], raw: false })
  })
  it('detects @raw', () => {
    expect(parseMentions('check @raw text', IDS)).toEqual({ scenes: [], raw: true })
  })
  it('ignores unknown scene numbers and dedupes', () => {
    expect(parseMentions('@Scene9 @Scene1 @Scene1', IDS)).toEqual({ scenes: ['C001_S01'], raw: false })
  })
})
