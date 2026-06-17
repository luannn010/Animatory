import type {
  Project, Scene, Asset, VendorScene, PostStage, Phase, GateStatus,
  TrackId, TrackProgress, DesignAsset, GenCandidate, StoryboardPanel, VoiceCast, VoiceOption,
  DialogueClip, Animatic, Bone, RigDoc,
} from './types'
import { PHASE_ORDER, PRE_TRACKS } from './phases'

// ── helpers ──────────────────────────────────────────────────────────────────

const delay = (ms = 110) => new Promise<void>(r => setTimeout(r, ms))
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function gatesUpTo(current: Phase): Record<Phase, GateStatus> {
  const idx = PHASE_ORDER.indexOf(current)
  const out = {} as Record<Phase, GateStatus>
  PHASE_ORDER.forEach((p, i) => {
    out[p] = i < idx ? 'passed' : i === idx ? 'open' : 'locked'
  })
  return out
}

// Pre-production tracks: ready once the phase is reached or passed, active when
// the project sits at `pre`, idle when pre hasn't started.
function seedPreTracks(current: Phase): Record<TrackId, TrackProgress> {
  const idx = PHASE_ORDER.indexOf(current)
  const preIdx = PHASE_ORDER.indexOf('pre')
  const status: TrackProgress['status'] = idx > preIdx ? 'ready' : idx === preIdx ? 'active' : 'idle'
  const done = status === 'ready' ? 6 : status === 'active' ? 3 : 0
  const out = {} as Record<TrackId, TrackProgress>
  PRE_TRACKS.forEach(t => { out[t] = { total: 6, done, status } })
  return out
}

// ── seed data ────────────────────────────────────────────────────────────────

function seedProjects(): Project[] {
  return [
    {
      id: 'ep01', title: 'Ep. 01 — The Awakening',
      thumbnail: 'linear-gradient(135deg,#1e3a5f,#2d5a9e)',
      phase: 'production', gates: gatesUpTo('production'), preTracks: seedPreTracks('production'),
      sceneCount: 24, createdAt: '2026-05-20T00:00:00Z',
    },
    {
      id: 'ep02', title: 'Ep. 02 — Shadows Fall',
      thumbnail: 'linear-gradient(135deg,#2d1b4e,#5b3480)',
      phase: 'pre', gates: gatesUpTo('pre'), preTracks: seedPreTracks('pre'),
      sceneCount: 18, createdAt: '2026-05-24T00:00:00Z',
    },
    {
      id: 'ep00', title: 'Ep. 00 — Pilot',
      thumbnail: 'linear-gradient(135deg,#0f3d2e,#1a5c40)',
      phase: 'post', gates: gatesUpTo('post'), preTracks: seedPreTracks('post'),
      sceneCount: 12, createdAt: '2026-05-10T00:00:00Z',
    },
    {
      id: 'ep03', title: 'Ep. 03 — The Storm',
      thumbnail: 'linear-gradient(135deg,#3b2000,#6b3d00)',
      phase: 'script', gates: gatesUpTo('script'), preTracks: seedPreTracks('script'),
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

// ── Phase-1 (Pre-Production) seed data ───────────────────────────────────────
// Hardcoded here; the real impl seeds from EntityRegistry (design assets, voice
// cast) + PipelineScene (storyboard panels, dialogue clips).

function seedDesignAssets(projectId: string): DesignAsset[] {
  const base: Omit<DesignAsset, 'id' | 'projectId' | 'candidates'>[] = [
    { kind: 'character', sourceEntity: 'Hana', displayName: 'Hana', promptText: 'young woman, red hair, determined', refImageUrl: null, stage: 'color', lockedRef: null },
    { kind: 'character', sourceEntity: 'Riku', displayName: 'Riku', promptText: 'man, dark coat, weary eyes', refImageUrl: null, stage: 'bw_final', lockedRef: null },
    { kind: 'location', sourceEntity: 'Apartment', displayName: 'Hana\'s Apartment', promptText: 'cramped city apartment, night, rain', refImageUrl: null, stage: 'rough', lockedRef: null },
    { kind: 'location', sourceEntity: 'Office', displayName: 'Riku\'s Office', promptText: 'cluttered office, monitors glowing', refImageUrl: null, stage: 'rough', lockedRef: null },
    { kind: 'prop', sourceEntity: 'Umbrella', displayName: 'Inverted Umbrella', promptText: 'black umbrella, wind-bent', refImageUrl: null, stage: 'locked', lockedRef: 'umbrella_locked.png' },
    { kind: 'prop', sourceEntity: 'Phone', displayName: 'Cracked Phone', promptText: 'smartphone, cracked screen, weather alert', refImageUrl: null, stage: 'color', lockedRef: null },
  ]
  const COUNT: Record<DesignAsset['stage'], number> = { rough: 0, bw_final: 3, color: 4, locked: 3 }
  return base.map((a, i) => {
    const id = `${projectId}-da${i + 1}`
    const n = COUNT[a.stage]
    const candidates: GenCandidate[] = Array.from({ length: n }, (_, j) => ({
      id: `${id}-c${j + 1}`, url: '', runId: null, prompt: a.promptText, createdAt: '2026-06-02T00:00:00Z',
      selected: j === 0 && a.stage !== 'rough',
    }))
    return { ...a, id, projectId, candidates }
  })
}

function seedStoryboardPanels(projectId: string, sceneId?: string): StoryboardPanel[] {
  const all: StoryboardPanel[] = [
    { id: `${projectId}-pb1`, sceneId: `${projectId}-sc1`, order: 1, image: null, source: 'empty', shotType: 'wide', action: 'Hana wakes to a crash', dialogueRef: null, durationS: 3, camera: 'static', sfx: 'thunder' },
    { id: `${projectId}-pb2`, sceneId: `${projectId}-sc1`, order: 2, image: null, source: 'generated', shotType: 'close', action: 'Eyes snap open', dialogueRef: null, durationS: 1.5, camera: 'push_in', sfx: '' },
    { id: `${projectId}-pb3`, sceneId: `${projectId}-sc2`, order: 1, image: null, source: 'empty', shotType: 'medium', action: 'She runs to the window', dialogueRef: null, durationS: 2, camera: 'pan', sfx: 'footsteps' },
    { id: `${projectId}-pb4`, sceneId: `${projectId}-sc3`, order: 1, image: null, source: 'drawn', shotType: 'wide', action: 'Riku slams his phone', dialogueRef: null, durationS: 2.5, camera: 'static', sfx: 'slam' },
  ]
  return sceneId ? all.filter(p => p.sceneId === sceneId) : all
}

const VOICE_OPTIONS: VoiceOption[] = [
  { voiceId: 'vo-aria', label: 'Aria — warm alto', gender: 'female', sampleUrl: '' },
  { voiceId: 'vo-kane', label: 'Kane — gravel baritone', gender: 'male', sampleUrl: '' },
  { voiceId: 'vo-mio', label: 'Mio — bright soprano', gender: 'female', sampleUrl: '' },
  { voiceId: 'vo-ren', label: 'Ren — measured tenor', gender: 'male', sampleUrl: '' },
]

function seedVoiceCast(projectId: string): VoiceCast[] {
  void projectId
  return [
    { character: 'Hana', voiceId: 'vo-aria', previewUrl: null, dominantEmotion: 'determined', lineCount: 14 },
    { character: 'Riku', voiceId: null, previewUrl: null, dominantEmotion: 'angry', lineCount: 9 },
    { character: 'Extras', voiceId: null, previewUrl: null, dominantEmotion: null, lineCount: 3 },
  ]
}

function seedDialogueClips(projectId: string, sceneId?: string): DialogueClip[] {
  const all: DialogueClip[] = [
    { id: `${projectId}-dc1`, sceneId: `${projectId}-sc6`, character: 'Hana', line: 'You felt it too.', emotion: 'tender', intensity: 'medium', audioUrl: null, durationS: 1.4, status: 'generated' },
    { id: `${projectId}-dc2`, sceneId: `${projectId}-sc6`, character: 'Riku', line: 'Everyone did.', emotion: 'anxious', intensity: 'high', audioUrl: null, durationS: 1.1, status: 'pending' },
    { id: `${projectId}-dc3`, sceneId: `${projectId}-sc6`, character: 'Hana', line: 'Then we don\'t have much time.', emotion: 'determined', intensity: 'high', audioUrl: null, durationS: 1.8, status: 'approved' },
  ]
  return sceneId ? all.filter(c => c.sceneId === sceneId) : all
}

function seedAnimatic(projectId: string): Animatic {
  return {
    projectId, status: 'draft', totalDurationS: 7.5,
    entries: [
      { panelId: `${projectId}-pb1`, sceneId: `${projectId}-sc1`, startS: 0, durationS: 3, audioClipId: null },
      { panelId: `${projectId}-pb2`, sceneId: `${projectId}-sc1`, startS: 3, durationS: 1.5, audioClipId: null },
      { panelId: `${projectId}-pb3`, sceneId: `${projectId}-sc2`, startS: 4.5, durationS: 2, audioClipId: null },
      { panelId: `${projectId}-pb4`, sceneId: `${projectId}-sc3`, startS: 6.5, durationS: 1, audioClipId: `${projectId}-dc1` },
    ],
  }
}

// A small demo skeleton so the rig editor isn't empty before art import: a spine
// up from the canvas, a neck, and one arm. Children's x/y are ignored (their
// pivot is the parent's tip); only the root's position is meaningful.
function seedRig(assetId: string): RigDoc {
  const b = (id: string, name: string, parent: string | null, x: number, y: number, len: number, angle: number): Bone =>
    ({ id, name, parent, x, y, len, angle, mesh: null })
  return {
    schema: 'animatory.rig/v1', assetId,
    skeleton: [
      b('b1', 'spine', null, 260, 320, 90, -Math.PI / 2),
      b('b2', 'neck', 'b1', 0, 0, 40, -Math.PI / 2),
      b('b3', 'arm_L', 'b1', 0, 0, 70, -Math.PI / 4),
    ],
    clips: [{ name: 'action_01', duration_s: 1, keyframes: [] }],
  }
}

// ── in-memory state ──────────────────────────────────────────────────────────

let projects: Project[] = seedProjects()
let newProjectCounter = 0
let rigs: Record<string, RigDoc> = {}

export function __resetStudioState(): void {
  projects = seedProjects()
  newProjectCounter = 0
  rigs = {}
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
      phase: 'script', gates: gatesUpTo('script'), preTracks: seedPreTracks('script'),
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
      p.gates[ph] = i < target ? 'passed' : i === target ? 'open' : 'locked'
    })
    p.phase = to
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

  // ── Phase-1 (Pre-Production) reads ─────────────────────────────────────────
  async getDesignAssets(projectId: string): Promise<DesignAsset[]> {
    await delay(); find(projectId); return seedDesignAssets(projectId)
  },
  async getStoryboardPanels(projectId: string, sceneId?: string): Promise<StoryboardPanel[]> {
    await delay(); find(projectId); return seedStoryboardPanels(projectId, sceneId)
  },
  async getVoiceCast(projectId: string): Promise<VoiceCast[]> {
    await delay(); find(projectId); return seedVoiceCast(projectId)
  },
  async getVoiceOptions(): Promise<VoiceOption[]> {
    await delay(); return clone(VOICE_OPTIONS)
  },
  async getDialogueClips(projectId: string, sceneId?: string): Promise<DialogueClip[]> {
    await delay(); find(projectId); return seedDialogueClips(projectId, sceneId)
  },
  async getAnimatic(projectId: string): Promise<Animatic> {
    await delay(); find(projectId); return seedAnimatic(projectId)
  },

  // ── Rig editor (bones-only v1) ─────────────────────────────────────────────
  async getRig(assetId: string): Promise<RigDoc> {
    await delay(); return clone(rigs[assetId] ?? seedRig(assetId))
  },
  async saveRig(doc: RigDoc): Promise<RigDoc> {
    await delay(80); rigs[doc.assetId] = clone(doc); return clone(doc)
  },
}
