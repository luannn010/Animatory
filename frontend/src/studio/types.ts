export type Phase = 'script' | 'pre' | 'production' | 'post'  // parse→script, vendor→production
export type TrackId = 'design' | 'storyboard' | 'audio'
export type GateStatus = 'locked' | 'open' | 'passed'

export interface TrackProgress {
  total: number
  done: number
  status: 'idle' | 'active' | 'ready'
}

export interface Project {
  id: string
  title: string
  thumbnail: string          // CSS gradient/color string (placeholder, no real images)
  createdAt: string
  sceneCount: number
  phase: Phase                              // furthest phase reached (routing default)
  preTracks: Record<TrackId, TrackProgress> // parallel pre-production tracks
  gates: Record<Phase, GateStatus>          // gate state per phase
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
  emoji: string              // placeholder thumbnail
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

// ── Phase-1 (Pre-Production) domain types ────────────────────────────────────
// Consumed by the mock facade + the future Design/Storyboard/Audio pages. Real
// impl seeds these from EntityRegistry + PipelineScene.

export type DesignKind = 'character' | 'location' | 'prop'
export type DesignStage = 'rough' | 'bw_final' | 'color' | 'locked'

export interface GenCandidate {
  id: string
  url: string
  runId: string | null
  prompt: string
  createdAt: string
  selected: boolean
}

export interface DesignAsset {
  id: string
  projectId: string
  kind: DesignKind
  sourceEntity: string
  displayName: string
  promptText: string
  refImageUrl: string | null
  stage: DesignStage
  candidates: GenCandidate[]
  lockedRef: string | null
  summary?: string           // one-line enrichment summary (real entities only)
}

export interface StoryboardPanel {
  id: string
  sceneId: string
  order: number
  image: string | null
  source: 'drawn' | 'generated' | 'empty'
  shotType: string
  action: string
  dialogueRef: string | null
  durationS: number | null
  camera: string
  sfx: string
}

export interface VoiceOption {
  voiceId: string
  label: string
  gender: string
  sampleUrl: string
}

export interface VoiceCast {
  character: string
  voiceId: string | null
  previewUrl: string | null
  dominantEmotion: string | null
  lineCount: number
}

export interface DialogueClip {
  id: string
  sceneId: string
  character: string
  line: string
  emotion: string | null
  intensity: string | null
  audioUrl: string | null
  durationS: number | null
  status: 'pending' | 'generated' | 'approved'
}

export interface AnimaticEntry {
  panelId: string
  sceneId: string
  startS: number
  durationS: number
  audioClipId: string | null
}

export interface Animatic {
  projectId: string
  status: 'draft' | 'final'
  totalDurationS: number
  entries: AnimaticEntry[]
}
