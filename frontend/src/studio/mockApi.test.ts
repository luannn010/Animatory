import { describe, it, expect, beforeEach } from 'vitest'
import { studioApi, __resetStudioState } from './mockApi'

describe('studioApi', () => {
  beforeEach(() => __resetStudioState())

  it('lists seeded projects at varied phases', async () => {
    const projects = await studioApi.listProjects()
    expect(projects.length).toBeGreaterThanOrEqual(4)
    const phases = projects.map(p => p.currentPhase)
    expect(phases).toContain('parse')
    expect(phases).toContain('pre')
    expect(phases).toContain('vendor')
    expect(phases).toContain('post')
  })

  it('gets a single project by id', async () => {
    const [first] = await studioApi.listProjects()
    const got = await studioApi.getProject(first.id)
    expect(got.id).toBe(first.id)
  })

  it('rejects unknown project id', async () => {
    await expect(studioApi.getProject('nope')).rejects.toThrow()
  })

  it('updates a project title and persists it', async () => {
    const [first] = await studioApi.listProjects()
    const updated = await studioApi.updateProjectTitle(first.id, 'Renamed')
    expect(updated.title).toBe('Renamed')
    const again = await studioApi.getProject(first.id)
    expect(again.title).toBe('Renamed')
  })

  it('creates a new project at the parse phase', async () => {
    const before = (await studioApi.listProjects()).length
    const created = await studioApi.createProject()
    expect(created.currentPhase).toBe('parse')
    expect(created.phases.parse).toBe('active')
    const after = (await studioApi.listProjects()).length
    expect(after).toBe(before + 1)
  })

  it('returns scenes, assets, vendor scenes, and post stages for a project', async () => {
    const projects = await studioApi.listProjects()
    const vendorProject = projects.find(p => p.currentPhase === 'vendor')!
    expect((await studioApi.getScenes(vendorProject.id)).length).toBeGreaterThan(0)
    expect((await studioApi.getAssets(vendorProject.id)).length).toBeGreaterThan(0)
    const vendorScenes = await studioApi.getVendorScenes(vendorProject.id)
    expect(vendorScenes.length).toBeGreaterThan(0)
    expect(vendorScenes.some(s => s.stageStatus === 'retake')).toBe(true)
    expect(vendorScenes.some(s => s.approved)).toBe(true)
    expect((await studioApi.getPostStages(vendorProject.id)).length).toBeGreaterThan(0)
  })

  it('advances a project to the next phase', async () => {
    const created = await studioApi.createProject()
    const advanced = await studioApi.advancePhase(created.id, 'pre')
    expect(advanced.currentPhase).toBe('pre')
    expect(advanced.phases.parse).toBe('complete')
    expect(advanced.phases.pre).toBe('active')
  })
})
