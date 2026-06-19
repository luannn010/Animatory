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

// ── Phase-1 (Pre-Production) domain types ────────────────────────────────────
// Consumed by the mock facade + the future Design/Storyboard/Audio pages. Real
// impl seeds these from EntityRegistry + PipelineScene.

export type DesignKind = 'character' | 'location' | 'prop'
export type DesignStage = 'rough' | 'color' | 'locked'

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

// ── Rig editor (bones-only v1) — see docs Rig Editor brief ────────────────────
// RigDoc is the stable export/import seam. v2 (mesh, IK, auto-rig) fills the
// reserved fields without reshaping these. Do not casually change field names.

export type RigMode = 'rig' | 'pose' | 'deform'   // deform = v2 stub in v1

// A bone is a pivot + length + rest angle in a parent→child hierarchy.
// `angle` is ABSOLUTE radians at rest; pose deltas are relative to rest.
export interface Bone {
  id: string                              // 'b1','b2' (render in Geist Mono)
  name: string                            // 'spine','arm_L','hand_L'…
  parent: string | null                   // null = root
  x: number                               // root pivot x in canvas space
  y: number                               // root pivot y in canvas space
  len: number                             // px
  angle: number                           // rest angle, absolute radians
  attach?: 'tip' | 'start'                // pivot on parent: tip (default) or start (e.g. thigh→hip)
  limits?: { min: number; max: number }   // v2 joint clamp — reserve now
  mesh: null                              // v2 deform mesh — ALWAYS null in v1
}

export interface Keyframe {
  t: number                               // 0..1 normalized over clip duration
  pose: Record<string, number>            // boneId → angle delta (radians) from rest
}

export interface MotionClip {
  name: string                            // 'action_01'
  duration_s: number                      // e.g. 1.0
  keyframes: Keyframe[]                    // sorted by t; ≥2 to play
}

export interface RigDoc {
  schema: 'animatory.rig/v1'
  assetId: string                         // the character Asset this rig belongs to
  skeleton: Bone[]
  clips: MotionClip[]                     // v1 authors ONE; array reserves multi-clip future
}

// Art-layer binding (§5): one PNG layer follows one bone (rigid in v1). Kept in
// editor state rather than RigDoc so the export seam stays exactly per spec.
export interface ArtLayer {
  id: string
  name: string
  src: string                             // object URL / data URL of the part image
  boneId: string | null                   // bound bone (null = unbound)
  offset: { x: number; y: number }        // layer origin relative to the bone pivot
  rotationOffset: number                  // radians added to the bone's resolved angle
}
