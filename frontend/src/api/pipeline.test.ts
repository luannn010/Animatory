// frontend/src/api/pipeline.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveText, saveScenes, getEntities, saveEntities, getVoiceProfiles, EMOTIONS } from './pipeline'

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('pipeline client', () => {
  it('saveText PUTs the text and returns the doc', async () => {
    const fetchMock = mockFetch({ chunk_id: 'C001', text: 'hi', edited: true })
    vi.stubGlobal('fetch', fetchMock)
    const res = await saveText('ep1', 'C001', 'hi')
    expect(res.edited).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/chunks/C001/text')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body).text).toBe('hi')
  })

  it('saveScenes throws on non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'bad' }, false, 422))
    await expect(saveScenes('ep1', 'C001', [])).rejects.toThrow(/422/)
  })
})

describe('parse-enrichment clients', () => {
  it('EMOTIONS exposes the controlled vocab', () => {
    expect(EMOTIONS).toContain('commanding')
    expect(EMOTIONS).toContain('neutral')
  })

  it('getEntities GETs the entities route', async () => {
    const f = mockFetch({ episode_id: 'ep1', characters: [], locations: [] })
    vi.stubGlobal('fetch', f)
    const reg = await getEntities('ep1')
    expect(reg.characters).toEqual([])
    expect(f.mock.calls[0][0]).toContain('/pipeline/episodes/ep1/entities')
  })

  it('saveEntities PUTs characters + locations', async () => {
    const f = mockFetch({ episode_id: 'ep1', characters: [{ canonical: 'X', aliases: [] }], locations: [] })
    vi.stubGlobal('fetch', f)
    const reg = await saveEntities('ep1', { characters: [{ canonical: 'X', aliases: [] }], locations: [] })
    expect(reg.characters[0].canonical).toBe('X')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/entities')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body).characters[0].canonical).toBe('X')
  })

  it('getVoiceProfiles GETs the voice-profiles route', async () => {
    const f = mockFetch({ episode_id: 'ep1', profiles: [{ character: 'A', line_count: 2, emotions: { angry: 2 }, dominant_emotion: 'angry', dominant_intensity: 'high' }] })
    vi.stubGlobal('fetch', f)
    const res = await getVoiceProfiles('ep1')
    expect(res.profiles[0].character).toBe('A')
    expect(f.mock.calls[0][0]).toContain('/pipeline/episodes/ep1/voice-profiles')
  })
})
