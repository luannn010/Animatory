// frontend/src/api/chat.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseSSE, streamChat } from './chat'

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

function streamResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('streamChat', () => {
  it('dispatches reply/tool/done handlers in order', async () => {
    const sse =
      'event: reply\ndata: {"delta":"Hi"}\n\n' +
      'event: tool\ndata: {"kind":"scene_edits","payload":{"scene_id":"C001_S01","changes":{"mood":"dark"}}}\n\n' +
      'event: done\ndata: {}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(sse)))

    const got: string[] = []
    await new Promise<void>(resolve => {
      streamChat('ep1', 'C001',
        { messages: [{ role: 'user', content: 'hi' }], thinking: false, mentions: { scenes: [], raw: false } },
        {
          onReply: d => got.push('reply:' + d),
          onTool: (k) => got.push('tool:' + k),
          onUsage: () => {},
          onDone: () => { got.push('done'); resolve() },
          onError: () => { got.push('error'); resolve() },
        })
    })
    expect(got).toEqual(['reply:Hi', 'tool:scene_edits', 'done'])
  })
})
