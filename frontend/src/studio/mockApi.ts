import type {
  Project, Scene, Asset, VendorScene, PostStage, Phase, PhaseStatus,
} from './types'
import { PHASE_ORDER } from './phases'

// ── helpers ──────────────────────────────────────────────────────────────────

const delay = (ms = 110) => new Promise<void>(r => setTimeout(r, ms))
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function phasesUpTo(current: Phase): Record<Phase, PhaseStatus> {
  const idx = PHASE_ORDER.indexOf(current)
  const out = {} as Record<Phase, PhaseStatus>
  PHASE_ORDER.forEach((p, i) => {
    out[p] = i < idx ? 'complete' : i === idx ? 'active' : 'locked'
  })
  return out
}

// ── seed data ────────────────────────────────────────────────────────────────

function seedProjects(): Project[] {
  return [
    {
      id: 'ep01', title: 'Ep. 01 — The Awakening',
      thumbnail: 'linear-gradient(135deg,#1e3a5f,#2d5a9e)',
      currentPhase: 'vendor', phases: phasesUpTo('vendor'),
      sceneCount: 24, createdAt: '2026-05-20T00:00:00Z',
    },
    {
      id: 'ep02', title: 'Ep. 02 — Shadows Fall',
      thumbnail: 'linear-gradient(135deg,#2d1b4e,#5b3480)',
      currentPhase: 'pre', phases: phasesUpTo('pre'),
      sceneCount: 18, createdAt: '2026-05-24T00:00:00Z',
    },
    {
      id: 'ep00', title: 'Ep. 00 — Pilot',
      thumbnail: 'linear-gradient(135deg,#0f3d2e,#1a5c40)',
      currentPhase: 'post', phases: phasesUpTo('post'),
      sceneCount: 12, createdAt: '2026-05-10T00:00:00Z',
    },
    {
      id: 'ep03', title: 'Ep. 03 — The Storm',
      thumbnail: 'linear-gradient(135deg,#3b2000,#6b3d00)',
      currentPhase: 'parse', phases: phasesUpTo('parse'),
      sceneCount: 22, createdAt: '2026-06-01T00:00:00Z',
    },
  ]
}

function seedScenes(projectId: string): Scene[] {
  const base: Omit<Scene, 'id' | 'projectId'>[] = [
    { number: 1, description: 'Hana wakes to a thunderous crash as lightning strobes across the skyline.', location: 'INT - Apartment', characters: ['Hana'], duration: '0:42' },
    { number: 2, description: 'She runs to the window and sees a storm cloud shaped like a face.', location: 'INT - Apartment', characters: ['Hana'], duration: '0:28' },
    { number: 3, description: 'Riku slams his phone down, staring at a weather alert on his monitor.', location: 'INT - Office', characters: ['Riku'], duration: '0:35' },
    { number: 4, description: 'City streets — citizens look up, confused. Umbrellas invert.', location: 'EXT - Street', characters: ['Extras'], duration: '1:04' },
    { number: 5, description: 'Hana sprints down the stairwell, dodging a falling light fitting.', location: 'INT - Stairwell', characters: ['Hana'], duration: '0:22' },
    { number: 6, description: 'Riku and Hana collide at the building exit. Recognition. Tension.', location: 'EXT - Building', characters: ['Hana', 'Riku'], duration: '0:48' },
  ]
  return base.map((s, i) => ({ ...s, id: `${projectId}-sc${i + 1}`, projectId }))
}

function seedAssets(projectId: string): Asset[] {
  const base: Omit<Asset, 'id' | 'projectId'>[] = [
    { name: 'Hana', type: 'character', status: 'done', emoji: '👩‍🦰' },
    { name: 'Riku', type: 'character', status: 'color', emoji: '👨' },
    { name: 'City BG', type: 'background', status: 'done', emoji: '🏙' },
    { name: 'Apartment BG', type: 'background', status: 'clean', emoji: '🏠' },
    { name: 'Office BG', type: 'background', status: 'rough', emoji: '🏢' },
    { name: 'Umbrella', type: 'prop', status: 'done', emoji: '☂️' },
    { name: 'Phone', type: 'prop', status: 'done', emoji: '📱' },
    { name: 'Lightning FX', type: 'fx', status: 'rough', emoji: '⚡' },
  ]
  return base.map((a, i) => ({ ...a, id: `${projectId}-as${i + 1}`, projectId }))
}

function seedVendorScenes(projectId: string): VendorScene[] {
  return [
    { id: `${projectId}-vs1`, projectId, sceneRef: 'SC-01', stage: 'editor',  stageStatus: 'done',   retakeCount: 0, completedStages: ['rigs','setup','block','animate','take1','editor'], approved: true },
    { id: `${projectId}-vs2`, projectId, sceneRef: 'SC-06', stage: 'animate', stageStatus: 'active', retakeCount: 0, completedStages: ['rigs','setup','block'], approved: false },
    { id: `${projectId}-vs3`, projectId, sceneRef: 'SC-09', stage: 'animate', stageStatus: 'retake', retakeCount: 2, completedStages: ['rigs','setup','block'], approved: false },
    { id: `${projectId}-vs4`, projectId, sceneRef: 'SC-15', stage: 'setup',   stageStatus: 'active', retakeCount: 0, completedStages: ['rigs'], approved: false },
    { id: `${projectId}-vs5`, projectId, sceneRef: 'SC-22', stage: 'rigs',    stageStatus: 'pending',retakeCount: 0, completedStages: [], approved: false },
  ]
}

function seedPostStages(projectId: string): PostStage[] {
  return [
    { id: `${projectId}-ps1`, name: 'Edit', sub: 'Assemble take 1s into cut', status: 'done' },
    { id: `${projectId}-ps2`, name: 'Dialogue', sub: 'Final mix from cast lines', status: 'done', parallel: true, track: 'dialogue' },
    { id: `${projectId}-ps3`, name: 'Music', sub: 'Score locked', status: 'active', parallel: true, track: 'music' },
    { id: `${projectId}-ps4`, name: 'SFX', sub: 'Foley + design', status: 'pending', parallel: true, track: 'sfx' },
    { id: `${projectId}-ps5`, name: 'Mix', sub: 'Dialogue, music, SFX balance', status: 'pending' },
    { id: `${projectId}-ps6`, name: 'Color Correction', sub: 'Grade and LUT application', status: 'active' },
    { id: `${projectId}-ps7`, name: 'Online / QC', sub: 'Final quality check, subtitles', status: 'pending' },
    { id: `${projectId}-ps8`, name: 'Deliver', sub: 'Export master files and upload', status: 'locked' },
  ]
}

// ── in-memory state ──────────────────────────────────────────────────────────

let projects: Project[] = seedProjects()
let newProjectCounter = 0

export function __resetStudioState(): void {
  projects = seedProjects()
  newProjectCounter = 0
}

function find(id: string): Project {
  const p = projects.find(x => x.id === id)
  if (!p) throw new Error(`project not found: ${id}`)
  return p
}

// ── api ──────────────────────────────────────────────────────────────────────

export const studioApi = {
  async listProjects(): Promise<Project[]> {
    await delay(); return clone(projects)
  },

  async getProject(id: string): Promise<Project> {
    await delay(); return clone(find(id))
  },

  async createProject(): Promise<Project> {
    await delay()
    newProjectCounter += 1
    const id = `new${newProjectCounter}`
    const project: Project = {
      id, title: `Untitled Episode ${newProjectCounter}`,
      thumbnail: 'linear-gradient(135deg,#334155,#1e293b)',
      currentPhase: 'parse', phases: phasesUpTo('parse'),
      sceneCount: 0, createdAt: '2026-06-02T00:00:00Z',
    }
    projects = [project, ...projects]
    return clone(project)
  },

  async updateProjectTitle(id: string, title: string): Promise<Project> {
    await delay(80)
    const p = find(id); p.title = title
    return clone(p)
  },

  async advancePhase(id: string, to: Phase): Promise<Project> {
    await delay(80)
    const p = find(id)
    const target = PHASE_ORDER.indexOf(to)
    PHASE_ORDER.forEach((ph, i) => {
      p.phases[ph] = i < target ? 'complete' : i === target ? 'active' : 'locked'
    })
    p.currentPhase = to
    return clone(p)
  },

  async getScenes(projectId: string): Promise<Scene[]> {
    await delay(); find(projectId); return seedScenes(projectId)
  },
  async getAssets(projectId: string): Promise<Asset[]> {
    await delay(); find(projectId); return seedAssets(projectId)
  },
  async getVendorScenes(projectId: string): Promise<VendorScene[]> {
    await delay(); find(projectId); return seedVendorScenes(projectId)
  },
  async getPostStages(projectId: string): Promise<PostStage[]> {
    await delay(); find(projectId); return seedPostStages(projectId)
  },
}
