// Rig editor state — a single reducer over bones, the working pose, keyframes,
// art layers, mode, selection, and the playhead. Pure and serializable so undo/
// redo and the studio accept/reject patterns drop in later. The canvas dispatches
// geometry-aware actions (it owns coordinates); the reducer owns the data model.
import type { ArtLayer, Bone, MotionClip, RigDoc, RigMode } from '../types'
import { poseAt, type Pose } from './fk'

export interface RigState {
  assetId: string
  bones: Bone[]
  clip: MotionClip          // v1 authors a single clip (RigDoc.clips[0])
  layers: ArtLayer[]        // art-layer bindings (§5), editor-side
  mode: RigMode
  selectedBoneId: string | null
  pose: Pose                // working pose deltas (the thing you edit in Pose mode)
  scrub: number             // playhead, 0..1
  playing: boolean
  dirty: boolean
}

export function emptyRig(assetId: string): RigDoc {
  return {
    schema: 'animatory.rig/v1',
    assetId,
    skeleton: [],
    clips: [{ name: 'action_01', duration_s: 1, keyframes: [] }],
  }
}

export function initRigState(doc: RigDoc, layers: ArtLayer[] = []): RigState {
  return {
    assetId: doc.assetId,
    bones: doc.skeleton,
    clip: doc.clips[0] ?? { name: 'action_01', duration_s: 1, keyframes: [] },
    layers,
    mode: 'rig',
    selectedBoneId: doc.skeleton[0]?.id ?? null,
    pose: {},
    scrub: 0,
    playing: false,
    dirty: false,
  }
}

export function toRigDoc(s: RigState): RigDoc {
  return { schema: 'animatory.rig/v1', assetId: s.assetId, skeleton: s.bones, clips: [s.clip] }
}

/** The pose to render: tweened clip pose while playing, else the working pose. */
export function previewPose(s: RigState): Pose {
  return s.playing ? poseAt(s.clip, s.scrub) : s.pose
}

function descendants(bones: Bone[], rootId: string): Set<string> {
  const out = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const b of bones) {
      if (b.parent && out.has(b.parent) && !out.has(b.id)) { out.add(b.id); grew = true }
    }
  }
  return out
}

export type RigAction =
  | { type: 'load'; doc: RigDoc; layers?: ArtLayer[] }
  | { type: 'setMode'; mode: RigMode }
  | { type: 'addBone'; bone: Bone }
  | { type: 'updateBone'; id: string; patch: Partial<Bone> }
  | { type: 'removeBone'; id: string }
  | { type: 'selectBone'; id: string | null }
  | { type: 'setPoseDelta'; id: string; delta: number }
  | { type: 'resetPose' }
  | { type: 'addKeyframe' }            // snapshot the working pose at the playhead
  | { type: 'removeKeyframe'; t: number }
  | { type: 'setScrub'; t: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setDuration'; seconds: number }
  | { type: 'addLayer'; layer: ArtLayer }
  | { type: 'updateLayer'; id: string; patch: Partial<ArtLayer> }
  | { type: 'removeLayer'; id: string }
  | { type: 'markClean' }
  | { type: 'markDirty' }

export function rigReducer(s: RigState, a: RigAction): RigState {
  switch (a.type) {
    case 'load':
      return initRigState(a.doc, a.layers ?? [])
    case 'markClean':
      return { ...s, dirty: false }
    case 'markDirty':
      return s.dirty ? s : { ...s, dirty: true }

    // ── selection / mode / playhead (non-dirtying) ──
    case 'setMode':
      return { ...s, mode: a.mode, playing: false }
    case 'selectBone':
      return { ...s, selectedBoneId: a.id }
    case 'setScrub':
      return { ...s, scrub: Math.max(0, Math.min(1, a.t)) }
    case 'play':
      return s.clip.keyframes.length >= 2 ? { ...s, playing: true } : s
    case 'pause':
      return { ...s, playing: false }

    // ── skeleton edits (dirty) ──
    case 'addBone':
      return { ...s, bones: [...s.bones, a.bone], selectedBoneId: a.bone.id, dirty: true }
    case 'updateBone':
      return {
        ...s, dirty: true,
        bones: s.bones.map(b => (b.id === a.id ? { ...b, ...a.patch } : b)),
      }
    case 'removeBone': {
      const drop = descendants(s.bones, a.id)
      const pose = { ...s.pose }
      for (const id of drop) delete pose[id]
      return {
        ...s, dirty: true, pose,
        bones: s.bones.filter(b => !drop.has(b.id)),
        layers: s.layers.map(l => (l.boneId && drop.has(l.boneId) ? { ...l, boneId: null } : l)),
        selectedBoneId: s.selectedBoneId && drop.has(s.selectedBoneId) ? null : s.selectedBoneId,
        clip: {
          ...s.clip,
          keyframes: s.clip.keyframes.map(k => {
            const p = { ...k.pose }; for (const id of drop) delete p[id]; return { ...k, pose: p }
          }),
        },
      }
    }

    // ── posing (working pose is transient → not dirty) ──
    case 'setPoseDelta':
      return { ...s, pose: { ...s.pose, [a.id]: a.delta } }
    case 'resetPose':
      return { ...s, pose: {} }

    // ── keyframes (dirty) ──
    case 'addKeyframe': {
      const t = s.scrub
      const others = s.clip.keyframes.filter(k => Math.abs(k.t - t) > 1e-4)
      const next = [...others, { t, pose: { ...s.pose } }].sort((x, y) => x.t - y.t)
      return { ...s, dirty: true, clip: { ...s.clip, keyframes: next } }
    }
    case 'removeKeyframe':
      return {
        ...s, dirty: true,
        clip: { ...s.clip, keyframes: s.clip.keyframes.filter(k => Math.abs(k.t - a.t) > 1e-4) },
      }
    case 'setDuration':
      return { ...s, dirty: true, clip: { ...s.clip, duration_s: Math.max(0.1, a.seconds) } }

    // ── art layers (dirty) ──
    case 'addLayer':
      return { ...s, dirty: true, layers: [...s.layers, a.layer] }
    case 'updateLayer':
      return { ...s, dirty: true, layers: s.layers.map(l => (l.id === a.id ? { ...l, ...a.patch } : l)) }
    case 'removeLayer':
      return { ...s, dirty: true, layers: s.layers.filter(l => l.id !== a.id) }

    default:
      return s
  }
}
