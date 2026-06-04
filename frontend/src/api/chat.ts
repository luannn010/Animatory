// frontend/src/api/chat.ts
import { API_BASE_URL } from '../config'

export interface ChatMention { scenes: string[]; raw: boolean }
export interface ChatUsage {
  prompt_tokens: number
  total_tokens: number
  context_limit: number
  skipped_mentions: string[]
}
export interface ChatStreamHandlers {
  onSession?(sessionId: string): void
  onTitle?(title: string): void
  onThinking?(delta: string): void
  onReply(delta: string): void
  onTool(kind: 'scene_edits' | 'text_corrections', payload: unknown): void
  onUsage(u: ChatUsage): void
  onDone(): void
  onError(detail: string): void
}
export interface SSERecord { event: string; data: string }

/** Pure: split a buffer into complete SSE records, returning the unparsed remainder. */
export function parseSSE(buffer: string): { records: SSERecord[]; rest: string } {
  const records: SSERecord[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length) records.push({ event, data: dataLines.join('\n') })
  }
  return { records, rest }
}

function dispatch(r: SSERecord, h: ChatStreamHandlers): void {
  let d: Record<string, unknown> = {}
  try { d = JSON.parse(r.data) } catch { return }
  switch (r.event) {
    case 'session': h.onSession?.(String(d.session_id ?? '')); break
    case 'title': h.onTitle?.(String(d.title ?? '')); break
    case 'thinking': h.onThinking?.(String(d.delta ?? '')); break
    case 'reply': h.onReply(String(d.delta ?? '')); break
    case 'tool': h.onTool(d.kind as 'scene_edits' | 'text_corrections', d.payload); break
    case 'usage': h.onUsage(d as unknown as ChatUsage); break
    case 'error': h.onError(String(d.detail ?? 'chat error')); break
    default: break
  }
}

export function streamChat(
  episodeId: string,
  chunkId: string,
  body: { session_id: string | null; message: string; thinking: boolean; mentions: ChatMention },
  handlers: ChatStreamHandlers,
): { abort(): void } {
  const ctrl = new AbortController()
  void (async () => {
    try {
      const url = `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/chat/stream`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) { handlers.onError(`chat failed ${res.status}`); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const { records, rest } = parseSSE(buf)
        buf = rest
        for (const r of records) dispatch(r, handlers)
      }
      handlers.onDone()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') handlers.onError(String(e))
    }
  })()
  return { abort: () => ctrl.abort() }
}

export interface ChatSessionMeta {
  session_id: string
  title: string | null
  token_count: number
  message_count: number
  updated_at: string
}
export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls: { kind: string; payload: unknown }[]
  created_at: string
}

function sessionsBase(episodeId: string, chunkId: string): string {
  return `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/chat/sessions`
}
async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw new Error(`${label} failed ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function listSessions(episodeId: string, chunkId: string): Promise<ChatSessionMeta[]> {
  return jsonOrThrow(await fetch(sessionsBase(episodeId, chunkId)), 'listSessions')
}
export async function createSession(episodeId: string, chunkId: string): Promise<ChatSessionMeta> {
  return jsonOrThrow(await fetch(sessionsBase(episodeId, chunkId), { method: 'POST' }), 'createSession')
}
export async function getSession(episodeId: string, chunkId: string, sessionId: string): Promise<{ session: ChatSessionMeta; messages: StoredMessage[] }> {
  return jsonOrThrow(await fetch(`${sessionsBase(episodeId, chunkId)}/${encodeURIComponent(sessionId)}`), 'getSession')
}
export async function renameSession(episodeId: string, chunkId: string, sessionId: string, title: string): Promise<ChatSessionMeta> {
  return jsonOrThrow(await fetch(`${sessionsBase(episodeId, chunkId)}/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
  }), 'renameSession')
}
export async function deleteSession(episodeId: string, chunkId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${sessionsBase(episodeId, chunkId)}/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteSession failed ${res.status}`)
}
