import { describe, it, expect } from 'vitest'
import { resolveBone, resolveSkeleton, easeInOut, poseAt } from './fk'
import type { Bone, MotionClip } from '../types'

const bone = (over: Partial<Bone> & Pick<Bone, 'id'>): Bone => ({
  name: over.id, parent: null, x: 0, y: 0, len: 100, angle: 0, mesh: null, ...over,
})

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

describe('resolveBone', () => {
  it('resolves a root bone at its own pivot with rest+delta angle', () => {
    const root = bone({ id: 'b1', x: 10, y: 20, len: 100, angle: 0 })
    const r = resolveBone('b1', [root], {})
    expect(r.x).toBe(10)
    expect(r.y).toBe(20)
    expect(r.angle).toBe(0)
    expect(near(r.tipX, 110)).toBe(true)  // 10 + cos(0)*100
    expect(near(r.tipY, 20)).toBe(true)   // 20 + sin(0)*100
  })

  it('applies a root pose delta to the absolute angle', () => {
    const root = bone({ id: 'b1', x: 0, y: 0, len: 100, angle: 0 })
    const r = resolveBone('b1', [root], { b1: Math.PI / 2 })
    expect(near(r.angle, Math.PI / 2)).toBe(true)
    expect(near(r.tipX, 0)).toBe(true)    // cos(90°)=0
    expect(near(r.tipY, 100)).toBe(true)  // sin(90°)=1
  })

  it("pivots a child at the parent's tip and accumulates angle", () => {
    // root along +x (len 100); child rest also 0 → straight line, tip at 200.
    const root = bone({ id: 'b1', x: 0, y: 0, len: 100, angle: 0 })
    const child = bone({ id: 'b2', parent: 'b1', len: 100, angle: 0 })
    const r = resolveBone('b2', [root, child], {})
    expect(near(r.x, 100)).toBe(true)     // pivot = parent tip
    expect(near(r.y, 0)).toBe(true)
    expect(near(r.angle, 0)).toBe(true)
    expect(near(r.tipX, 200)).toBe(true)
  })

  it('propagates a parent rotation to the child (FK inheritance)', () => {
    // Rotate the root 90°: its tip swings to (0,100); the child inherits the
    // rotation and extends another 100 in +y → tip (0,200).
    const root = bone({ id: 'b1', x: 0, y: 0, len: 100, angle: 0 })
    const child = bone({ id: 'b2', parent: 'b1', len: 100, angle: 0 })
    const r = resolveBone('b2', [root, child], { b1: Math.PI / 2 })
    expect(near(r.x, 0)).toBe(true)
    expect(near(r.y, 100)).toBe(true)
    expect(near(r.angle, Math.PI / 2)).toBe(true)
    expect(near(r.tipX, 0)).toBe(true)
    expect(near(r.tipY, 200)).toBe(true)
  })

  it('preserves a child rest offset relative to its parent', () => {
    // Child rests at +90° relative to a root at 0° → child points +y from the tip.
    const root = bone({ id: 'b1', x: 0, y: 0, len: 100, angle: 0 })
    const child = bone({ id: 'b2', parent: 'b1', len: 100, angle: Math.PI / 2 })
    const r = resolveBone('b2', [root, child], {})
    expect(near(r.x, 100)).toBe(true)
    expect(near(r.angle, Math.PI / 2)).toBe(true)
    expect(near(r.tipX, 100)).toBe(true)
    expect(near(r.tipY, 100)).toBe(true)
  })

  it('a child delta rotates only the child, not the parent', () => {
    const root = bone({ id: 'b1', x: 0, y: 0, len: 100, angle: 0 })
    const child = bone({ id: 'b2', parent: 'b1', len: 100, angle: 0 })
    const r = resolveBone('b2', [root, child], { b2: Math.PI / 2 })
    expect(near(r.x, 100)).toBe(true)     // parent tip unchanged
    expect(near(r.angle, Math.PI / 2)).toBe(true)
    expect(near(r.tipX, 100)).toBe(true)
    expect(near(r.tipY, 100)).toBe(true)
  })

  it('treats a missing/broken parent as a root rather than throwing', () => {
    const orphan = bone({ id: 'b9', parent: 'nope', x: 5, y: 5 })
    const r = resolveBone('b9', [orphan], {})
    expect(r.x).toBe(5)
    expect(r.y).toBe(5)
  })

  it('resolveSkeleton resolves every bone once', () => {
    const bones = [
      bone({ id: 'b1', x: 0, y: 0, len: 100, angle: 0 }),
      bone({ id: 'b2', parent: 'b1', len: 100, angle: 0 }),
    ]
    const map = resolveSkeleton(bones, {})
    expect(map.size).toBe(2)
    expect(near(map.get('b2')!.tipX, 200)).toBe(true)
  })
})

describe('easeInOut', () => {
  it('is clamped and symmetric around the midpoint', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(-5)).toBe(0)
    expect(easeInOut(5)).toBe(1)
    expect(near(easeInOut(0.5), 0.5)).toBe(true)
    expect(easeInOut(0.25)).toBeLessThan(0.25)   // slow start
    expect(easeInOut(0.75)).toBeGreaterThan(0.75) // fast then settle
  })
})

describe('poseAt', () => {
  const clip: MotionClip = {
    name: 'action_01', duration_s: 1,
    keyframes: [{ t: 0, pose: { b1: 0 } }, { t: 1, pose: { b1: Math.PI } }],
  }

  it('returns the endpoints exactly', () => {
    expect(near(poseAt(clip, 0).b1, 0)).toBe(true)
    expect(near(poseAt(clip, 1).b1, Math.PI)).toBe(true)
  })

  it('eases between keyframes (midpoint is half the delta)', () => {
    expect(near(poseAt(clip, 0.5).b1, Math.PI / 2)).toBe(true)  // easeInOut(0.5)=0.5
  })

  it('clamps out-of-range time to the nearest keyframe', () => {
    expect(near(poseAt(clip, -1).b1, 0)).toBe(true)
    expect(near(poseAt(clip, 2).b1, Math.PI)).toBe(true)
  })

  it('handles a single keyframe by returning it unchanged', () => {
    const one: MotionClip = { name: 'x', duration_s: 1, keyframes: [{ t: 0.3, pose: { b1: 1 } }] }
    expect(poseAt(one, 0.9)).toEqual({ b1: 1 })
  })
})
