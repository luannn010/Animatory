// frontend/src/api/chat.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseSSE, streamChat, createSession, renameSession, deleteSession } from './chat'

afterEach(() => vi.unstubAllGlobals())

describe('parseSSE', () => {
  it('splits complete records and keeps the remainder', () => {
    const buf = 'event: reply\ndata: {"delta":"hi"}\n\nevent: done\ndata: {}\n\nevent: par'
    const { records, rest } = parseSSE(buf)
    expect(records).toEqual([
      { event: 'reply', data: '{"delta":"hi"}' },
      { event: 'done', data: '{}' },
    ])
    expect(rest).toBe('event: par')
  })
})

function jsonResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body, text: async () => JSON.stringify(body) })
}

describe('session api', () => {
  it('createSession POSTs to the sessions route', async () => {
    const f = jsonResponse({ session_id: 's1', title: null })
    vi.stubGlobal('fetch', f)
    const s = await createSession('ep1', 'C001')
    expect(s.session_id).toBe('s1')
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/chunks/C001/chat/sessions')
    expect(init.method).toBe('POST')
  })

  it('renameSession PATCHes title; deleteSession DELETEs', async () => {
    const f = jsonResponse({ session_id: 's1', title: 'X' })
    vi.stubGlobal('fetch', f)
    await renameSession('ep1', 'C001', 's1', 'X')
    expect(f.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(f.mock.calls[0][1].body).title).toBe('X')
    const d = jsonResponse({ ok: true })
    vi.stubGlobal('fetch', d)
    await deleteSession('ep1', 'C001', 's1')
    expect(d.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('streamChat A2 body + events', () => {
  function streamResponse(text: string): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() },
    })
    return { ok: true, status: 200, body: stream } as unknown as Response
  }

  it('sends session_id + message and dispatches session/title', async () => {
    const sse =
      'event: session\ndata: {"session_id":"s9"}\n\n' +
      'event: reply\ndata: {"delta":"hi"}\n\n' +
      'event: title\ndata: {"title":"T"}\n\n' +
      'event: done\ndata: {}\n\n'
    const f = vi.fn().mockResolvedValue(streamResponse(sse))
    vi.stubGlobal('fetch', f)
    const got: string[] = []
    await new Promise<void>(resolve => {
      streamChat('ep1', 'C001',
        { session_id: null, message: 'hi', thinking: false, mentions: { scenes: [], raw: false } },
        {
          onSession: id => got.push('session:' + id),
          onReply: d => got.push('reply:' + d),
          onTitle: t => got.push('title:' + t),
          onTool: () => {}, onUsage: () => {},
          onDone: () => { got.push('done'); resolve() },
          onError: () => { got.push('err'); resolve() },
        })
    })
    expect(got).toEqual(['session:s9', 'reply:hi', 'title:T', 'done'])
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ session_id: null, message: 'hi' })
  })
})
