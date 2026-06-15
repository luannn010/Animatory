import { describe, it, expect, beforeEach } from 'vitest'
import { studioApi, __resetStudioState } from './mockApi'

describe('studioApi', () => {
  beforeEach(() => __resetStudioState())

  it('lists seeded projects at varied phases', async () => {
    const projects = await studioApi.listProjects()
    expect(projects.length).toBeGreaterThanOrEqual(4)
    const phases = projects.map(p => p.phase)
    expect(phases).toContain('script')
    expect(phases).toContain('pre')
    expect(phases).toContain('production')
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

  it('creates a new project at the script phase', async () => {
    const before = (await studioApi.listProjects()).length
    const created = await studioApi.createProject()
    expect(created.phase).toBe('script')
    expect(created.gates.script).toBe('open')
    expect(created.preTracks.design.status).toBe('idle')
    const after = (await studioApi.listProjects()).length
    expect(after).toBe(before + 1)
  })

  it('returns scenes, assets, production scenes, and post stages for a project', async () => {
    const projects = await studioApi.listProjects()
    const prodProject = projects.find(p => p.phase === 'production')!
    expect((await studioApi.getScenes(prodProject.id)).length).toBeGreaterThan(0)
    expect((await studioApi.getAssets(prodProject.id)).length).toBeGreaterThan(0)
    const vendorScenes = await studioApi.getVendorScenes(prodProject.id)
    expect(vendorScenes.length).toBeGreaterThan(0)
    expect(vendorScenes.some(s => s.stageStatus === 'retake')).toBe(true)
    expect(vendorScenes.some(s => s.approved)).toBe(true)
    expect((await studioApi.getPostStages(prodProject.id)).length).toBeGreaterThan(0)
  })

  it('advances a project to the next phase', async () => {
    const created = await studioApi.createProject()
    const advanced = await studioApi.advancePhase(created.id, 'pre')
    expect(advanced.phase).toBe('pre')
    expect(advanced.gates.script).toBe('passed')
    expect(advanced.gates.pre).toBe('open')
  })

  it('serves the Phase-1 pre-production reads', async () => {
    const [first] = await studioApi.listProjects()
    expect((await studioApi.getDesignAssets(first.id)).length).toBeGreaterThan(0)
    expect((await studioApi.getStoryboardPanels(first.id)).length).toBeGreaterThan(0)
    expect((await studioApi.getVoiceCast(first.id)).length).toBeGreaterThan(0)
    expect((await studioApi.getVoiceOptions()).length).toBeGreaterThan(0)
    expect((await studioApi.getDialogueClips(first.id)).length).toBeGreaterThan(0)
    const animatic = await studioApi.getAnimatic(first.id)
    expect(animatic.entries.length).toBeGreaterThan(0)
  })
})
