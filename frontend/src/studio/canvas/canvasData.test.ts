import { describe, it, expect } from 'vitest'
import { seedCanvasScenes, sceneById, shotById, isAnimated, animatedCount, STATUS_ORDER } from './canvasData'

describe('canvasData', () => {
  it('seeds the four-scene fixture, each with shots', () => {
    const s = seedCanvasScenes()
    expect(s.map(x => x.id)).toEqual(['SC-001', 'SC-002', 'SC-003', 'SC-004'])
    expect(s.every(x => x.shots.length > 0)).toBe(true)
    expect(s[0].slug).toBe('EXT. RAIN ALLEY — DAWN')
  })

  it('sceneById resolves, else falls back to the first scene', () => {
    const s = seedCanvasScenes()
    expect(sceneById(s, 'SC-003').id).toBe('SC-003')
    expect(sceneById(s, 'nope').id).toBe('SC-001')
    expect(sceneById(s, undefined).id).toBe('SC-001')
  })

  it('shotById resolves, else falls back to the first shot', () => {
    const s = seedCanvasScenes()
    const sc = s[1]
    expect(shotById(sc, 'SH-0023').id).toBe('SH-0023')
    expect(shotById(sc, 'nope').id).toBe(sc.shots[0].id)
  })

  it('isAnimated is true only for animated|done', () => {
    expect(isAnimated('animated')).toBe(true)
    expect(isAnimated('done')).toBe(true)
    expect(isAnimated('boarded')).toBe(false)
    expect(isAnimated('extracted')).toBe(false)
  })

  it('animatedCount counts animated/done shots per scene', () => {
    const s = seedCanvasScenes()
    expect(animatedCount(s[0])).toBe(2)   // SH-0011 done + SH-0012 animated
    expect(animatedCount(s[3])).toBe(0)   // both extracted
  })

  it('STATUS_ORDER is the pipeline enum in order', () => {
    expect(STATUS_ORDER).toEqual(['extracted', 'designed', 'boarded', 'animated', 'done'])
  })
})
