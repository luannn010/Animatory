import { describe, expect, it } from 'vitest'
import { applyParseEvent, initialParseStream } from './parseStream'
import type { RunEvent } from '../types'

const ev = (type: RunEvent['type'], data: RunEvent['data']): RunEvent =>
  ({ type, run_id: 'r1', timestamp: '', data })

describe('applyParseEvent', () => {
  it('reveals this chunk\'s scenes and ignores other chunks', () => {
    let s = initialParseStream()
    s = applyParseEvent(s, ev('chunk_parsed', { chunk_id: 'C002', scenes: [{ scene_id: 'C002_S01' } as never] }), 'C001')
    expect(s.scenesReceived).toBe(false) // other chunk → ignored
    s = applyParseEvent(s, ev('chunk_parsed', { chunk_id: 'C001', scenes: [{ scene_id: 'C001_S01' } as never] }), 'C001')
    expect(s.scenesReceived).toBe(true)
    expect(s.scenes).toHaveLength(1)
  })

  it('tracks phase transitions', () => {
    let s = initialParseStream()
    expect(s.phase).toBe('scenes')
    s = applyParseEvent(s, ev('phase', { phase: 'describing' }), 'C001')
    expect(s.phase).toBe('describing')
  })

  it('upserts characters and locations by canonical', () => {
    let s = initialParseStream()
    s = applyParseEvent(s, ev('entity_described', { kind: 'character', entry: { canonical: 'Từ An', aliases: [] } as never }), 'C001')
    s = applyParseEvent(s, ev('entity_described', { kind: 'location', entry: { canonical: 'Phòng', aliases: [] } as never }), 'C001')
    expect(s.characters.map(c => c.canonical)).toEqual(['Từ An'])
    expect(s.locations.map(l => l.canonical)).toEqual(['Phòng'])
    // re-describe replaces, not duplicates
    s = applyParseEvent(s, ev('entity_described', { kind: 'character', entry: { canonical: 'Từ An', aliases: [], description: { summary: 'a censor' } } as never }), 'C001')
    expect(s.characters).toHaveLength(1)
    expect((s.characters[0].description as { summary: string }).summary).toBe('a censor')
  })

  it('stores voice profiles', () => {
    let s = initialParseStream()
    s = applyParseEvent(s, ev('voice_profiles', { profiles: [{ character: 'Từ An', line_count: 3 } as never] }), 'C001')
    expect(s.profiles).toHaveLength(1)
  })

  it('patches a scene summary onto the matching scene', () => {
    let s = initialParseStream()
    s = applyParseEvent(s, ev('chunk_parsed', { chunk_id: 'C001', scenes: [{ scene_id: 'C001_S01' } as never] }), 'C001')
    s = applyParseEvent(s, ev('scene_summary', { scene_id: 'C001_S01', summary: 'He stands.' }), 'C001')
    expect(s.scenes[0].summary).toBe('He stands.')
  })

  it('ignores unrelated events', () => {
    const s0 = initialParseStream()
    const s1 = applyParseEvent(s0, ev('log', { message: '[1/2] x' }), 'C001')
    expect(s1).toEqual(s0)
  })
})
