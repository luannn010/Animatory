// Forward-kinematics for the bones-only rig (§4 of the Rig Editor brief).
// `resolveBone` is intentionally pure — it's the piece that breaks silently when
// proportions or parenting change, so it carries the unit tests (fk.test.ts).
import type { Bone, MotionClip } from '../types'

/** A bone's resolved world transform: pivot, absolute angle, and tip. */
export interface Resolved {
  x: number      // pivot x
  y: number      // pivot y
  angle: number  // absolute angle (radians)
  tipX: number   // pivot + (cos,sin)·len
  tipY: number
}

/** boneId → angle delta (radians) from rest. Missing bone = 0 delta. */
export type Pose = Record<string, number>

function indexBones(bones: Bone[]): Map<string, Bone> {
  const m = new Map<string, Bone>()
  for (const b of bones) m.set(b.id, b)
  return m
}

/**
 * Resolve one bone's absolute transform by walking up the parent chain,
 * accumulating rest-relative offsets plus pose deltas.
 *
 *   root  → { x, y, angle: rest + delta }
 *   child → pivot = parent.tip (or parent.start when attach==='start');
 *           angle = parentAngle + (childRest − parentRest) + childDelta
 *   tip   → pivot + (cos, sin)·len
 *
 * `cache` (optional) memoizes resolved bones so a deep chain stays O(n).
 * A missing parent or a parent cycle degrades to treating the bone as a root.
 */
export function resolveBone(
  boneId: string,
  bones: Bone[] | Map<string, Bone>,
  pose: Pose = {},
  cache: Map<string, Resolved> = new Map(),
  seen: Set<string> = new Set(),
): Resolved {
  const byId = bones instanceof Map ? bones : indexBones(bones)
  const cached = cache.get(boneId)
  if (cached) return cached

  const bone = byId.get(boneId)
  if (!bone) {
    const zero = { x: 0, y: 0, angle: 0, tipX: 0, tipY: 0 }
    return zero
  }
  const delta = pose[boneId] ?? 0

  let pivotX: number, pivotY: number, angle: number
  const parent = bone.parent ? byId.get(bone.parent) : undefined
  if (!parent || seen.has(boneId)) {
    // root (or broken parent / cycle): pivot is the bone's own position
    pivotX = bone.x
    pivotY = bone.y
    angle = bone.angle + delta
  } else {
    const next = new Set(seen)
    next.add(boneId)
    const p = resolveBone(parent.id, byId, pose, cache, next)
    // Most bones pivot on the parent's tip; a few (e.g. thigh→hip) attach at the
    // parent's start so they fan out from the same joint as their parent.
    if (bone.attach === 'start') {
      pivotX = p.x
      pivotY = p.y
    } else {
      pivotX = p.tipX
      pivotY = p.tipY
    }
    angle = p.angle + (bone.angle - parent.angle) + delta
  }

  const resolved: Resolved = {
    x: pivotX,
    y: pivotY,
    angle,
    tipX: pivotX + Math.cos(angle) * bone.len,
    tipY: pivotY + Math.sin(angle) * bone.len,
  }
  cache.set(boneId, resolved)
  return resolved
}

/** Resolve every bone once, sharing a cache. */
export function resolveSkeleton(bones: Bone[], pose: Pose = {}): Map<string, Resolved> {
  const byId = indexBones(bones)
  const cache = new Map<string, Resolved>()
  for (const b of bones) resolveBone(b.id, byId, pose, cache)
  return cache
}

/** Cubic ease-in-out, clamped to [0,1]. */
export function easeInOut(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * Sample a clip's pose at normalized time `u` (0..1), ease-in-out tweening the
 * per-bone deltas between the surrounding keyframes. Keyframes are sorted by `t`
 * internally; <2 keyframes returns the single (or empty) pose unchanged.
 */
export function poseAt(clip: MotionClip, u: number): Pose {
  const kfs = [...clip.keyframes].sort((a, b) => a.t - b.t)
  if (kfs.length === 0) return {}
  if (kfs.length === 1) return { ...kfs[0].pose }

  const x = u < 0 ? 0 : u > 1 ? 1 : u
  if (x <= kfs[0].t) return { ...kfs[0].pose }
  if (x >= kfs[kfs.length - 1].t) return { ...kfs[kfs.length - 1].pose }

  let a = kfs[0], b = kfs[kfs.length - 1]
  for (let i = 0; i < kfs.length - 1; i++) {
    if (x >= kfs[i].t && x <= kfs[i + 1].t) { a = kfs[i]; b = kfs[i + 1]; break }
  }
  const span = b.t - a.t
  const localT = span > 0 ? (x - a.t) / span : 0
  const e = easeInOut(localT)

  const out: Pose = {}
  const ids = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)])
  for (const id of ids) {
    const from = a.pose[id] ?? 0
    const to = b.pose[id] ?? 0
    out[id] = from + (to - from) * e
  }
  return out
}
