import { describe, it, expect } from 'vitest'
import { PHASE_ORDER, PHASE_META, phasePath, preTrackPath, isPhaseReachable, canAdvance } from './phases'
import type { Project } from './types'

const project: Project = {
  id: 'p1', title: 'T', thumbnail: '#000', createdAt: '2026-06-01T00:00:00Z', sceneCount: 3,
  phase: 'production',
  gates: { script: 'passed', pre: 'passed', production: 'open', post: 'locked' },
  preTracks: {
    design: { total: 6, done: 6, status: 'ready' },
    storyboard: { total: 6, done: 6, status: 'ready' },
    audio: { total: 6, done: 6, status: 'ready' },
  },
}

describe('phases', () => {
  it('orders the four phases', () => {
    expect(PHASE_ORDER).toEqual(['script', 'pre', 'production', 'post'])
  })
  it('maps phase ids to URL segments (script keeps /parse, production replaces /vendor)', () => {
    expect(phasePath('p1', 'script')).toBe('/project/p1/parse')
    expect(phasePath('p1', 'production')).toBe('/project/p1/production')
    expect(phasePath('p1', 'pre')).toBe('/project/p1/pre')
  })
  it('builds pre-track paths', () => {
    expect(preTrackPath('p1', 'design')).toBe('/project/p1/pre/design')
    expect(preTrackPath('p1', 'checking')).toBe('/project/p1/pre/checking')
  })
  it('exposes a label per phase', () => {
    expect(PHASE_META.script.label).toBe('Script')
    expect(PHASE_META.post.label).toBe('Post-production')
  })
  it('exposes a short label per phase', () => {
    expect(PHASE_META.script.short).toBe('Script')
    expect(PHASE_META.pre.short).toBe('Pre')
    expect(PHASE_META.production.short).toBe('Production')
    expect(PHASE_META.post.short).toBe('Post')
  })
  it('treats passed and open gates as reachable, locked as not', () => {
    expect(isPhaseReachable(project, 'script')).toBe(true)
    expect(isPhaseReachable(project, 'production')).toBe(true)
    expect(isPhaseReachable(project, 'post')).toBe(false)
  })
  it('canAdvance from pre requires all tracks ready', () => {
    expect(canAdvance(project, 'pre')).toBe(true)
    const blocked = { ...project, preTracks: { ...project.preTracks, audio: { total: 6, done: 1, status: 'active' as const } } }
    expect(canAdvance(blocked, 'pre')).toBe(false)
    expect(canAdvance(blocked, 'script')).toBe(true) // non-pre gates have no track requirement
  })
})
