import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamRun } from './client'
import type { RunEvent } from '../types'

// A minimal fake EventSource so we can drive named SSE events at the wrapper.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  listeners: Record<string, Array<(e: { data: string }) => void>> = {}
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this) }
  addEventListener(t: string, h: (e: { data: string }) => void) { (this.listeners[t] ||= []).push(h) }
  removeEventListener() {}
  close() {}
  emit(t: string, data: string) { (this.listeners[t] || []).forEach(h => h({ data })) }
}

describe('streamRun forwards structured parse events', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  })
  afterEach(() => vi.unstubAllGlobals())

  function collect() {
    const es = streamRun('r1')
    const seen: RunEvent[] = []
    es.addEventListener('message', (e: MessageEvent) => seen.push(JSON.parse(e.data as string)))
    return { source: FakeEventSource.instances[0], seen }
  }

  it('relays chunk_parsed with its scenes payload', () => {
    const { source, seen } = collect()
    source.emit('chunk_parsed', JSON.stringify({ chunk_id: 'C001', index: 1, total: 2, scenes: [{ scene_id: 'C001_S01' }] }))
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('chunk_parsed')
    expect(seen[0].data.chunk_id).toBe('C001')
    expect(seen[0].data.scenes).toHaveLength(1)
  })

  it('relays entity_described and voice_profiles', () => {
    const { source, seen } = collect()
    source.emit('entity_described', JSON.stringify({ kind: 'character', entry: { canonical: 'Từ An', description: { summary: 'a censor' } } }))
    source.emit('voice_profiles', JSON.stringify({ profiles: [{ character: 'Từ An', line_count: 3 }] }))
    expect(seen.map(s => s.type)).toEqual(['entity_described', 'voice_profiles'])
    expect((seen[0].data.entry as Record<string, unknown>).canonical).toBe('Từ An')
    expect(seen[1].data.profiles).toHaveLength(1)
  })

  it('relays phase and scene_summary', () => {
    const { source, seen } = collect()
    source.emit('phase', JSON.stringify({ phase: 'describing' }))
    source.emit('scene_summary', JSON.stringify({ scene_id: 'C001_S01', summary: 'He stands.' }))
    expect(seen[0].data.phase).toBe('describing')
    expect(seen[1].data.summary).toBe('He stands.')
  })

  it('still relays log events', () => {
    const { source, seen } = collect()
    source.emit('log', JSON.stringify({ message: '[1/2] Parsed C001' }))
    expect(seen[0].type).toBe('log')
    expect(seen[0].data.message).toBe('[1/2] Parsed C001')
  })
})
