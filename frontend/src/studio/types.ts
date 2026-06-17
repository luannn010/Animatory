export type Phase = 'parse' | 'pre' | 'vendor' | 'post'
export type PhaseStatus = 'locked' | 'active' | 'complete'

export interface Project {
  id: string
  title: string
  thumbnail: string          // CSS gradient/color string (placeholder, no real images)
  currentPhase: Phase
  phases: Record<Phase, PhaseStatus>
  sceneCount: number
  createdAt: string
}

export interface Scene {
  id: string
  projectId: string
  number: number
  description: string
  location: string
  characters: string[]
  duration: string           // e.g. "0:42"
}

export type AssetType = 'character' | 'prop' | 'background' | 'fx'
export type AssetStatus = 'rough' | 'clean' | 'color' | 'done'

export interface Asset {
  id: string
  projectId: string
  name: string
  type: AssetType
  status: AssetStatus
  emoji: string              // placeholder thumbnail (shown until a real rig ref exists)
  thumbnailUrl?: string      // rig reference image (OutputArtifact.artifact_url) when built
}

export type VendorStage = 'rigs' | 'setup' | 'block' | 'animate' | 'take1' | 'editor'
export type VendorStageStatus = 'pending' | 'active' | 'done' | 'retake'

export interface VendorScene {
  id: string
  projectId: string
  sceneRef: string           // e.g. "SC-01"
  stage: VendorStage
  stageStatus: VendorStageStatus
  retakeCount: number
  completedStages: VendorStage[]
  approved: boolean
}

export type PostStatus = 'done' | 'active' | 'pending' | 'locked'

export interface PostStage {
  id: string
  name: string
  sub: string
  status: PostStatus
  parallel?: boolean         // true = rendered inside the audio-tracks block
  track?: 'dialogue' | 'music' | 'sfx'
}
