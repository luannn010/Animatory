// Thin client for the mesh-deform backend (animatory/deform) + the imagegen
// asset list it feeds from. Talks straight to the real backend (these routes are
// not part of the mockable studio facade). See docs spec 2026-06-19-mesh-deform.
import { API_BASE_URL } from '../config'

export interface RigAsset {
  jobId: string
  imageUrl: string | null
  characterId: string | null
  seed: number | null
  createdAt: string | null
}

export interface BindBone { id: string; x: number; y: number; tipX: number; tipY: number }
export interface VertexWeight { bones: string[]; values: number[] }
export type Density = 'coarse' | 'medium' | 'fine'
export interface MeshParams { density: Density; interiorPoints: boolean; weightMethod: 'distance-falloff' | 'bone-heat' }

export interface MeshData {
  assetId: string
  version: number
  vertices: number[]
  triangles: number[]
  uvs: number[]
  bindPose: Record<string, number[]>
  weights: VertexWeight[]
  textureUrl: string
  status: string
  generatedAt: string | null
  params: MeshParams
}

export interface MeshJob {
  jobId: string
  assetId: string
  status: string
  progress: number
  stage: string | null
  error: string | null
}

const A = API_BASE_URL

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const deformApi = {
  /** Generated character renders (imagegen rig assets), newest first. */
  listRigAssets: () =>
    json<Array<Record<string, unknown>>>(`${A}/imagegen/assets?type=rig&status=done`).then(rows =>
      rows.map((r): RigAsset => ({
        jobId: String(r.job_id),
        imageUrl: (r.image_url as string) ?? null,
        characterId: (r.character_id as string) ?? null,
        seed: (r.seed as number) ?? null,
        createdAt: (r.created_at as string) ?? null,
      })),
    ),

  generate: (assetId: string, body: { params: MeshParams; bones: BindBone[]; imageRef?: string; imageDataUrl?: string }) =>
    json<MeshJob>(`${A}/studio/assets/${encodeURIComponent(assetId)}/mesh/generate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getMesh: (assetId: string) => json<MeshData>(`${A}/studio/assets/${encodeURIComponent(assetId)}/mesh`),

  streamUrl: (assetId: string, jobId: string) =>
    `${A}/studio/assets/${encodeURIComponent(assetId)}/mesh/jobs/${jobId}/stream`,

  /** Absolute URL for a backend-served /outputs image path. */
  imageSrc: (imageUrl: string | null) => (imageUrl ? `${A}${imageUrl}` : ''),
}
