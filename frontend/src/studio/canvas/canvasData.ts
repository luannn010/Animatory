// Pre-Production Canvas — data model + fixture.
// Shapes mirror the redesign's pipeline outputs (entities + scene parse): a
// scene owns ordered shots, and `status` is the single source of truth for
// pipeline progress. Mock-seeded in v1; the real seam is studioApi.getCanvasScenes.

export type CanvasStatus = 'extracted' | 'designed' | 'boarded' | 'animated' | 'done'

export const STATUS_ORDER: CanvasStatus[] = ['extracted', 'designed', 'boarded', 'animated', 'done']

export const STATUS_LABEL: Record<CanvasStatus, string> = {
  extracted: 'Extracted',
  designed: 'Designed',
  boarded: 'Boarded',
  animated: 'Animated',
  done: 'Done',
}

/** A shot is animated once it has (or has passed) a baked clip. */
export function isAnimated(status: CanvasStatus): boolean {
  return status === 'animated' || status === 'done'
}

export interface CanvasShot {
  id: string                 // 'SH-0011'
  action: string
  dialogue: string           // '' = no line
  camera: string             // 'Slow push-in'
  duration: string           // '2.4s' — display string, not seconds
  sfx: string
  status: CanvasStatus
  baked: boolean             // a baked animation clip exists
  characters: string[]       // character asset ids present in the shot
}

export interface CanvasScene {
  id: string                 // 'SC-001'
  slug: string               // 'EXT. RAIN ALLEY — DAWN'
  locationId: string         // 'loc_0431-alley'
  status: CanvasStatus
  shots: CanvasShot[]
}

// ── fixture (ported verbatim from the design kit's canvasData.jsx) ────────────
export function seedCanvasScenes(): CanvasScene[] {
  return [
    {
      id: 'SC-001', slug: 'EXT. RAIN ALLEY — DAWN', locationId: 'loc_0431-alley', status: 'animated',
      shots: [
        { id: 'SH-0011', action: "Dawn over the rain-slick alley; the slate's glow finds Mara's face.", dialogue: '', camera: 'Slow push-in', duration: '2.4s', sfx: 'Rain, distant thunder', status: 'done', baked: true, characters: ['char_0117-mara'] },
        { id: 'SH-0012', action: 'Mara thumbs the slate awake, reads the route.', dialogue: "(under breath) Only way that's still mine.", camera: 'OTS, handheld', duration: '1.8s', sfx: 'Slate chime', status: 'animated', baked: true, characters: ['char_0117-mara'] },
        { id: 'SH-0013', action: 'She pockets it and steps into the downpour.', dialogue: '', camera: 'Low wide', duration: '2.0s', sfx: 'Footsteps, splash', status: 'boarded', baked: false, characters: ['char_0117-mara'] },
      ],
    },
    {
      id: 'SC-002', slug: 'INT. TRANSIT TERMINAL — DAY', locationId: 'loc_0434-term', status: 'boarded',
      shots: [
        { id: 'SH-0021', action: 'Kade intercepts her at the turnstile, blocking the gate.', dialogue: 'You took the long way.', camera: 'Two-shot, medium', duration: '3.4s', sfx: 'Crowd murmur', status: 'boarded', baked: false, characters: ['char_0117-mara', 'char_0118-kade'] },
        { id: 'SH-0022', action: 'Reverse on Mara — unbothered, already counting exits.', dialogue: 'Let them count.', camera: 'CU, static', duration: '2.1s', sfx: 'PA announce', status: 'boarded', baked: false, characters: ['char_0117-mara'] },
        { id: 'SH-0023', action: 'Wide: the terminal swallows them as a convoy rolls past.', dialogue: '', camera: 'Crane wide', duration: '2.8s', sfx: 'Engine, brakes', status: 'designed', baked: false, characters: [] },
        { id: 'SH-0024', action: "Kade's hand drifts toward the alarm panel.", dialogue: 'Then walk fast.', camera: 'Insert, rack focus', duration: '1.5s', sfx: 'Panel beep', status: 'designed', baked: false, characters: ['char_0118-kade'] },
      ],
    },
    {
      id: 'SC-003', slug: 'INT. SAFEHOUSE — NIGHT', locationId: 'loc_0433-safe', status: 'designed',
      shots: [
        { id: 'SH-0031', action: "The Broker's message flickers across the pendant on the table.", dialogue: '', camera: 'Macro, slow tilt', duration: '3.1s', sfx: 'Static crackle', status: 'designed', baked: false, characters: [] },
        { id: 'SH-0032', action: 'Nan leans into the lamplight, decoding the map fragment.', dialogue: "It's not a place. It's a time.", camera: 'MS, warm key', duration: '4.4s', sfx: 'Paper, pen', status: 'designed', baked: false, characters: ['char_0120-nan'] },
        { id: 'SH-0033', action: 'The pendant splits — true coordinates bloom in the air.', dialogue: '', camera: 'CU, focus pull', duration: '2.0s', sfx: 'Chime, hum', status: 'extracted', baked: false, characters: [] },
      ],
    },
    {
      id: 'SC-004', slug: 'EXT. SYNDICATE ROOF — NIGHT', locationId: 'loc_0432-roof', status: 'extracted',
      shots: [
        { id: 'SH-0041', action: 'Rooftop chase as drones sweep the skyline floodlights.', dialogue: '', camera: 'Steadicam wide', duration: '7.5s', sfx: 'Drone whir, wind', status: 'extracted', baked: false, characters: ['char_0117-mara'] },
        { id: 'SH-0042', action: 'Kade cuts the power; the roof drops into blue dark.', dialogue: 'Lights out.', camera: 'MS, whip pan', duration: '3.0s', sfx: 'Breaker thunk', status: 'extracted', baked: false, characters: ['char_0118-kade'] },
      ],
    },
  ]
}

/** Resolve a scene by id, falling back to the first scene (never throws). */
export function sceneById(scenes: CanvasScene[], id: string | undefined): CanvasScene {
  return scenes.find(s => s.id === id) ?? scenes[0]
}

/** Resolve a shot within a scene, falling back to the scene's first shot. */
export function shotById(scene: CanvasScene, id: string | undefined): CanvasShot {
  return scene.shots.find(sh => sh.id === id) ?? scene.shots[0]
}

/** Count of animated/done shots in a scene — drives the rail progress meter. */
export function animatedCount(scene: CanvasScene): number {
  return scene.shots.filter(sh => isAnimated(sh.status)).length
}

// ── studio libraries (entity registry stand-ins; used by the Rig Studio) ──────
export interface LibEntry { id: string; name: string; kind: 'character' | 'location' | 'prop' }

export const CHAR_LIB: LibEntry[] = [
  { id: 'char_0117-mara', name: 'Mara', kind: 'character' },
  { id: 'char_0118-kade', name: 'Kade', kind: 'character' },
  { id: 'char_0119-brkr', name: 'The Broker', kind: 'character' },
  { id: 'char_0120-nan', name: 'Nan', kind: 'character' },
]
export const LOC_LIB: LibEntry[] = [
  { id: 'loc_0431-alley', name: 'Rain Alley', kind: 'location' },
  { id: 'loc_0432-roof', name: 'Syndicate Roof', kind: 'location' },
  { id: 'loc_0433-safe', name: 'Safehouse', kind: 'location' },
  { id: 'loc_0434-term', name: 'Transit Terminal', kind: 'location' },
]
export const OBJ_LIB: LibEntry[] = [
  { id: 'prop_0210-slate', name: 'Data-slate', kind: 'prop' },
  { id: 'prop_0211-pend', name: 'Pendant', kind: 'prop' },
]

export function charById(id: string): LibEntry | undefined { return CHAR_LIB.find(c => c.id === id) }
export function locById(id: string): LibEntry | undefined { return LOC_LIB.find(l => l.id === id) }
