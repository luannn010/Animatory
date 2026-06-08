// frontend/src/spellcheck/useSpellCheckWS.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_BASE_URL } from '../config'
import type { Finding, RawFinding } from './types'
import { dropOverlaps } from './offsets'

type ServerEvent =
  | { type: 'chunk_started'; chunk_index: number; total_chunks: number }
  | { type: 'chunk_findings'; chunk_index: number; findings: RawFinding[] }
  | { type: 'naming_findings'; findings: RawFinding[] }
  | { type: 'complete'; total_findings: number }
  | { type: 'error'; chunk_index: number; message: string }
  | { type: 'error_fatal'; message: string }

export interface SpellCheckState {
  findings: Finding[]
  totalChunks: number
  startedChunks: number
  done: boolean
  errors: { chunk_index: number; message: string }[]
  fatal: string | null
}

export const initialState: SpellCheckState = {
  findings: [], totalChunks: 0, startedChunks: 0, done: false, errors: [], fatal: null,
}

let _seq = 0
function withIds(raw: RawFinding[]): Finding[] {
  return raw.map(r => ({ ...r, id: `f${_seq++}`, status: 'pending' as const }))
}

/** Pure state transition — unit-tested without a live socket. */
export function reduce(state: SpellCheckState, ev: ServerEvent): SpellCheckState {
  switch (ev.type) {
    case 'chunk_started':
      return { ...state, totalChunks: ev.total_chunks, startedChunks: state.startedChunks + 1 }
    case 'chunk_findings':
    case 'naming_findings': {
      const merged = dropOverlaps([...state.findings, ...withIds(ev.findings)])
      return { ...state, findings: merged }
    }
    case 'complete':
      return { ...state, done: true }
    case 'error':
      return { ...state, errors: [...state.errors, { chunk_index: ev.chunk_index, message: ev.message }] }
    case 'error_fatal':
      return { ...state, fatal: ev.message, done: true }
    default:
      return state
  }
}

export interface SpellCheckWS {
  state: SpellCheckState
  /** Mutate findings (apply/edit/reset) from the consuming component. */
  setFindings: (next: Finding[]) => void
  close: () => void
}

export function useSpellCheckWS(episodeId: string, chunkId: string, document: string): SpellCheckWS {
  const [state, setState] = useState<SpellCheckState>(initialState)
  const wsRef = useRef<WebSocket | null>(null)

  const setFindings = useCallback((next: Finding[]) => {
    setState(s => ({ ...s, findings: next }))
  }, [])

  const close = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    setState(initialState)
    const url = `${WS_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/spellcheck/ws`
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ action: 'start', document }))
    ws.onmessage = e => {
      try { setState(s => reduce(s, JSON.parse(e.data as string) as ServerEvent)) } catch { /* ignore */ }
    }
    ws.onerror = () => setState(s => ({ ...s, fatal: s.fatal ?? 'connection error', done: true }))
    return () => { ws.close(); wsRef.current = null }
    // Re-open only when the target chunk or document identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, chunkId, document])

  return { state, setFindings, close }
}
