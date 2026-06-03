// frontend/src/api/pipeline.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveText, saveScenes } from './pipeline'

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
