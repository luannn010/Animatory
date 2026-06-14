// frontend/src/api/pipeline.ts
import { API_BASE_URL } from '../config'

export interface ChunkResult {
  episode_id: string
  display_name: string
  chunk_count: number
  output_dir: string
}

export interface ParseResult {
  run_id: string
}

export interface EpisodeStatus {
  episode_id: string
  display_name: string | null
  chunk_count: number
  parsed_count: number
  status: 'chunked' | 'partial' | 'complete' | 'empty'
}

export interface ChunkInfo {
  chunk_id: string
  file: string
  word_count: number | null
  parsed: boolean
  scene_count: number | null
}

export interface EpisodeChunks {
  episode_id: string
  chunk_count: number
  parsed_count: number
  status: 'chunked' | 'partial' | 'complete' | 'empty'
  chunks: ChunkInfo[]
}

export const EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised',
  'tender', 'mocking', 'commanding', 'anxious', 'determined', 'disgusted',
] as const
export const INTENSITIES = ['low', 'medium', 'high'] as const

export interface SceneDialogue {
  character: string
  line: string
  emotion?: string | null
  intensity?: string | null
}

export interface PipelineScene {
  scene_id: string
  location: string
  characters: string[]
  shot_type: string
  action: string
  dialogue: SceneDialogue[]
  mood: string
  narration?: string[]
  summary?: string | null  // synthesized storyboard caption (enrichment phase)
}

export interface ChunkScenes {
  chunk_id: string
  source_file: string
  model: string
  parsed_at: string
  scenes: PipelineScene[]
  edited: boolean
}

export interface ChunkText {
  chunk_id: string
  file: string
  word_count: number | null
  text: string
  edited: boolean
}

export async function chunkTranscript(
  file: File,
  episodeId?: string,
  name?: string,
): Promise<ChunkResult> {
  const form = new FormData()
  form.append('file', file)
  const params = new URLSearchParams()
  if (episodeId) params.set('episode_id', episodeId)
  if (name) params.set('name', name)
  const qs = params.toString()
  const url = `${API_BASE_URL}/pipeline/chunk${qs ? `?${qs}` : ''}`
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

export async function listChunks(episodeId: string): Promise<EpisodeChunks> {
  const res = await fetch(
    `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks`,
  )
  if (!res.ok) throw new Error(`listChunks failed ${res.status}`)
  return res.json()
}

export async function getChunkScenes(
  episodeId: string,
  chunkId: string,
): Promise<ChunkScenes> {
  const res = await fetch(
    `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/scenes`,
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`getChunkScenes failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getChunkText(
  episodeId: string,
  chunkId: string,
): Promise<ChunkText> {
  const res = await fetch(
    `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}/text`,
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`getChunkText failed ${res.status}: ${text}`)
  }
  return res.json()
}

export interface TextCorrection {
  find: string
  replace: string
  rationale: string
  all_occurrences: boolean
  category?: string  // name | location | word | dialogue (spell-check pass)
}

export interface ScenePatch {
  scene_id: string
  changes: Partial<Omit<PipelineScene, 'scene_id'>>
  rationale: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function chunkBase(episodeId: string, chunkId: string): string {
  return `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}/chunks/${encodeURIComponent(chunkId)}`
}

async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${label} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function saveText(episodeId: string, chunkId: string, text: string): Promise<ChunkText> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/text`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return jsonOrThrow<ChunkText>(res, 'saveText')
}

export async function resetText(episodeId: string, chunkId: string): Promise<ChunkText> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/text/edited`, { method: 'DELETE' })
  return jsonOrThrow<ChunkText>(res, 'resetText')
}

export async function saveScenes(
  episodeId: string, chunkId: string, scenes: PipelineScene[],
): Promise<ChunkScenes> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/scenes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenes }),
  })
  return jsonOrThrow<ChunkScenes>(res, 'saveScenes')
}

export async function resetScenes(episodeId: string, chunkId: string): Promise<ChunkScenes> {
  const res = await fetch(`${chunkBase(episodeId, chunkId)}/scenes/edited`, { method: 'DELETE' })
  return jsonOrThrow<ChunkScenes>(res, 'resetScenes')
}

export interface CharacterDescription {
  summary: string
  appearance: string
  attire: string
  age_build: string
  palette: string
}

export interface LocationDescription {
  summary: string
  setting: string
  lighting: string
  time_variants: string[]
}

export interface CharacterVoice {
  register: string
  tone: string
  pace: string
  dominant_emotion: string
  dominant_intensity: string
  line_count: number
}

export interface EntityEntry {
  canonical: string
  aliases: string[]
  // Structured enrichment blocks (optional; absent on un-enriched names).
  description?: CharacterDescription | LocationDescription | null
  voice?: CharacterVoice | null
  appears_in?: string[]
  generated?: boolean
}

export interface EntityRegistry {
  episode_id: string
  updated_at: string | null
  characters: EntityEntry[]
  locations: EntityEntry[]
}

export interface VoiceProfile {
  character: string
  line_count: number
  emotions: Record<string, number>
  dominant_emotion: string | null
  dominant_intensity: string | null
}

export interface VoiceProfilesResult {
  episode_id: string
  profiles: VoiceProfile[]
}

function episodeBase(episodeId: string): string {
  return `${API_BASE_URL}/pipeline/episodes/${encodeURIComponent(episodeId)}`
}

export async function getEntities(episodeId: string): Promise<EntityRegistry> {
  const res = await fetch(`${episodeBase(episodeId)}/entities`)
  return jsonOrThrow<EntityRegistry>(res, 'getEntities')
}

export async function saveEntities(
  episodeId: string,
  body: { characters: EntityEntry[]; locations: EntityEntry[] },
): Promise<EntityRegistry> {
  // EntityEntry carries the structured description/voice blocks so edits persist.
  const res = await fetch(`${episodeBase(episodeId)}/entities`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<EntityRegistry>(res, 'saveEntities')
}

export async function getVoiceProfiles(episodeId: string): Promise<VoiceProfilesResult> {
  const res = await fetch(`${episodeBase(episodeId)}/voice-profiles`)
  return jsonOrThrow<VoiceProfilesResult>(res, 'getVoiceProfiles')
}

export async function reparseScene(
  episodeId: string, chunkId: string, sceneId: string,
): Promise<{ scene: PipelineScene }> {
  const res = await fetch(
    `${chunkBase(episodeId, chunkId)}/scenes/${encodeURIComponent(sceneId)}/reparse`,
    { method: 'POST' },
  )
  return jsonOrThrow<{ scene: PipelineScene }>(res, 'reparseScene')
}

export interface SceneSource {
  found: boolean
  match_lines: number[]
  line_start: number
  line_end: number
  excerpt: string
}

export async function getSceneSource(
  episodeId: string, chunkId: string, sceneId: string,
): Promise<SceneSource> {
  const res = await fetch(
    `${chunkBase(episodeId, chunkId)}/scenes/${encodeURIComponent(sceneId)}/source`,
  )
  return jsonOrThrow<SceneSource>(res, 'getSceneSource')
}

