import { describe, it, expect } from 'vitest'
import { PHASE_ORDER, PHASE_META, phasePath, isPhaseReachable } from './phases'
import type { Project } from './types'

const project: Project = {
  id: 'p1', title: 'T', thumbnail: '#000', currentPhase: 'vendor',
  phases: { parse: 'complete', pre: 'complete', vendor: 'active', post: 'locked' },
  sceneCount: 3, createdAt: '2026-06-01T00:00:00Z',
}

describe('phases', () => {
  it('orders the four phases', () => {
    expect(PHASE_ORDER).toEqual(['parse', 'pre', 'vendor', 'post'])
  })
  it('builds a project phase path', () => {
    expect(phasePath('p1', 'vendor')).toBe('/project/p1/vendor')
  })
  it('exposes a label per phase', () => {
    expect(PHASE_META.parse.label).toBe('Parse')
    expect(PHASE_META.post.label).toBe('Post-production')
  })
  it('treats complete and active phases as reachable, locked as not', () => {
    expect(isPhaseReachable(project, 'parse')).toBe(true)
    expect(isPhaseReachable(project, 'vendor')).toBe(true)
    expect(isPhaseReachable(project, 'post')).toBe(false)
  })
})
