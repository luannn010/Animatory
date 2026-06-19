// The default character rig: a 17-bone humanoid skeleton + a soft "skin"
// silhouette that deforms with it. Stands in for imported character art until
// real art layers are bound (§5). Authored for the 600×600 stage, ordered
// parents-before-children so a single pass lays out every pivot.
import type { Bone } from '../types'

const D2R = Math.PI / 180

// Absolute rest angles in degrees (0 = +x, 90 = down, -90 = up). `start` is only
// given for the root; every child derives its pivot from its parent.
interface Spec {
  id: string; name: string; parent: string | null
  attach?: 'tip' | 'start'; len: number; abs: number; start?: { x: number; y: number }
}

const SPEC: Spec[] = [
  { id: 'hips',   name: 'Hips',          parent: null,     len: 44, abs: -90, start: { x: 300, y: 338 } },
  { id: 'spine',  name: 'Spine',         parent: 'hips',   len: 52, abs: -90 },
  { id: 'chest',  name: 'Chest',         parent: 'spine',  len: 30, abs: -90 },
  { id: 'neck',   name: 'Neck',          parent: 'chest',  len: 18, abs: -90 },
  { id: 'head',   name: 'Head',          parent: 'neck',   len: 44, abs: -90 },
  { id: 'armUL',  name: 'Upper arm · L', parent: 'chest',  len: 54, abs: 122 },
  { id: 'armFL',  name: 'Forearm · L',   parent: 'armUL',  len: 48, abs: 104 },
  { id: 'handL',  name: 'Hand · L',      parent: 'armFL',  len: 16, abs: 104 },
  { id: 'armUR',  name: 'Upper arm · R', parent: 'chest',  len: 54, abs: 58 },
  { id: 'armFR',  name: 'Forearm · R',   parent: 'armUR',  len: 48, abs: 76 },
  { id: 'handR',  name: 'Hand · R',      parent: 'armFR',  len: 16, abs: 76 },
  { id: 'thighL', name: 'Thigh · L',     parent: 'hips',   attach: 'start', len: 64, abs: 99 },
  { id: 'shinL',  name: 'Shin · L',      parent: 'thighL', len: 60, abs: 92 },
  { id: 'footL',  name: 'Foot · L',      parent: 'shinL',  len: 24, abs: 162 },
  { id: 'thighR', name: 'Thigh · R',     parent: 'hips',   attach: 'start', len: 64, abs: 81 },
  { id: 'shinR',  name: 'Shin · R',      parent: 'thighR', len: 60, abs: 88 },
  { id: 'footR',  name: 'Foot · R',      parent: 'shinR',  len: 24, abs: 18 },
]

/** The default humanoid skeleton as runtime `Bone[]` (absolute rest angles). */
export function buildHumanoid(): Bone[] {
  const start: Record<string, { x: number; y: number }> = {}
  const tip: Record<string, { x: number; y: number }> = {}
  const bones: Bone[] = []
  for (const s of SPEC) {
    const a = s.abs * D2R
    const st = s.parent
      ? (s.attach === 'start' ? start[s.parent] : tip[s.parent])
      : (s.start ?? { x: 300, y: 300 })
    start[s.id] = st
    tip[s.id] = { x: st.x + Math.cos(a) * s.len, y: st.y + Math.sin(a) * s.len }
    bones.push({
      id: s.id, name: s.name, parent: s.parent,
      x: st.x, y: st.y, len: s.len, angle: a,
      attach: s.attach ?? 'tip', mesh: null,
    })
  }
  return bones
}

// Soft silhouette: capsule width per bone (only these bones get skin, so a
// hand-drawn skeleton shows none). Drawn translucent so the bones lead.
export const SKIN_WIDTHS: Record<string, number> = {
  spine: 34, chest: 40, hips: 38,
  armUL: 16, armFL: 12, armUR: 16, armFR: 12,
  thighL: 20, shinL: 15, thighR: 20, shinR: 15,
}
export const SKIN_HEAD = { boneId: 'head', r: 26 }
export const SKIN_FILL = '#cdb79a'
