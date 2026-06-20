// frontend/src/api/pipeline.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveText, saveScenes, getEntities, saveEntities, getVoiceProfiles, enrichEntities, EMOTIONS, reparseScene, getSceneSource } from './pipeline'

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

  it('enrichEntities POSTs the enrich route with the canonical target and returns a run_id', async () => {
    const f = mockFetch({ run_id: 'run-123' })
    vi.stubGlobal('fetch', f)
    const res = await enrichEntities('ep1', { canonical: 'Từ An' })
    expect(res.run_id).toBe('run-123')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/enrich')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).canonical).toBe('Từ An')
  })

  it('enrichEntities defaults to an empty body (enrich all) and throws on non-ok', async () => {
    const ok = mockFetch({ run_id: 'r' })
    vi.stubGlobal('fetch', ok)
    await enrichEntities('ep1')
    expect(JSON.parse(ok.mock.calls[0][1].body)).toEqual({})
    vi.stubGlobal('fetch', mockFetch({ detail: 'no scenes' }, false, 409))
    await expect(enrichEntities('ep1')).rejects.toThrow(/409/)
  })
})

describe('reparseScene client', () => {
  it('POSTs to the scene reparse route and returns the scene', async () => {
    const f = mockFetch({ scene: { scene_id: 'C001_S01', location: 'L', characters: [], shot_type: 'wide', action: 'new', dialogue: [], mood: 'm', narration: [] } })
    vi.stubGlobal('fetch', f)
    const { scene } = await reparseScene('ep1', 'C001', 'C001_S01')
    expect(scene.action).toBe('new')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/chunks/C001/scenes/C001_S01/reparse')
    expect(init.method).toBe('POST')
  })

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'nope' }, false, 404))
    await expect(reparseScene('ep1', 'C001', 'X')).rejects.toThrow(/404/)
  })
})

describe('getSceneSource client', () => {
  it('GETs the scene source route and returns the match', async () => {
    const f = mockFetch({ found: true, match_lines: [1], line_start: 1, line_end: 1, excerpt: 'x' })
    vi.stubGlobal('fetch', f)
    const res = await getSceneSource('ep1', 'C001', 'C001_S03')
    expect(res.found).toBe(true)
    expect(res.match_lines).toEqual([1])
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/pipeline/episodes/ep1/chunks/C001/scenes/C001_S03/source')
    expect(init).toBeUndefined()  // plain GET, no init object
  })

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'no' }, false, 409))
    await expect(getSceneSource('ep1', 'C001', 'X')).rejects.toThrow(/409/)
  })
})
