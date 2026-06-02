// frontend/src/api/pipeline.ts
import { API_BASE_URL } from '../config'

export interface ChunkResult {
  episode_id: string
  chunk_count: number
  output_dir: string
}

export interface ParseResult {
  run_id: string
}

export interface EpisodeStatus {
  episode_id: string
  chunk_count: number
  parsed_count: number
  status: 'chunked' | 'partial' | 'complete' | 'empty'
}

export async function chunkTranscript(
  file: File,
  episodeId?: string,
): Promise<ChunkResult> {
  const form = new FormData()
  form.append('file', file)
  const url = episodeId
    ? `${API_BASE_URL}/pipeline/chunk?episode_id=${encodeURIComponent(episodeId)}`
    : `${API_BASE_URL}/pipeline/chunk`
  const res = await fetch(url, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`chunk failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function parseEpisode(
  episodeId: string,
  chunkIds?: string[],
): Promise<ParseResult> {
  const res = await fetch(`${API_BASE_URL}/pipeline/parse/${encodeURIComponent(episodeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chunk_ids: chunkIds ?? null }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`parse failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function listEpisodes(): Promise<EpisodeStatus[]> {
  const res = await fetch(`${API_BASE_URL}/pipeline/episodes`)
  if (!res.ok) throw new Error(`listEpisodes failed ${res.status}`)
  return res.json()
}
