import { API_BASE_URL } from '../config'
import type {
  Project, Scene, Asset, VendorScene, PostStage, Phase,
} from './types'

const BASE = `${API_BASE_URL}/studio`

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    throw new Error(`studio API ${res.status} ${res.statusText} for ${path}`)
  }
  return res.json() as Promise<T>
}

/**
 * Real HTTP studio API. Structurally identical to the mock `studioApi` for the
 * methods the views use, so the two are interchangeable behind the facade.
 */
export const studioHttpApi = {
  listProjects: () => http<Project[]>('/projects'),

  getProject: (id: string) => http<Project>(`/projects/${id}`),

  createProject: () =>
    http<Project>('/projects', { method: 'POST', body: JSON.stringify({}) }),

  updateProjectTitle: (id: string, title: string) =>
    http<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),

  advancePhase: (id: string, to: Phase) =>
    http<Project>(`/projects/${id}/advance`, { method: 'POST', body: JSON.stringify({ to }) }),

  getScenes: (projectId: string) => http<Scene[]>(`/projects/${projectId}/scenes`),
  getAssets: (projectId: string) => http<Asset[]>(`/projects/${projectId}/assets`),
  getVendorScenes: (projectId: string) => http<VendorScene[]>(`/projects/${projectId}/vendor-scenes`),
  getPostStages: (projectId: string) => http<PostStage[]>(`/projects/${projectId}/post-stages`),
}

// ── Live-only extras (model seams) ────────────────────────────────────────────
// Not part of the shared studioApi surface yet — available for wiring the live
// parse/casting UI once the real model workflows land.

export interface ParseJob {
  jobId: string
  projectId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  progress: number
  logs: string[]
  scenes: Scene[]
  error: string | null
}

export interface VoicePreview {
  character: string
  voice: string
  audioUrl: string
  durationS: number
}

export const studioLive = {
  startParse: (projectId: string, text = '', filenames: string[] = []) =>
    http<ParseJob>(`/projects/${projectId}/parse`, {
      method: 'POST',
      body: JSON.stringify({ text, filenames }),
    }),

  getParseJob: (jobId: string) => http<ParseJob>(`/parse-jobs/${jobId}`),

  streamParseJob: (jobId: string) =>
    new EventSource(`${BASE}/parse-jobs/${jobId}/stream`),

  voicePreview: (projectId: string, character: string, voice = 'Voice A') =>
    http<VoicePreview>(
      `/projects/${projectId}/casting/${encodeURIComponent(character)}/preview?voice=${encodeURIComponent(voice)}`,
      { method: 'POST' },
    ),
}
