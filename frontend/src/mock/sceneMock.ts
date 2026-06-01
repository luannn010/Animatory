import type { SceneFanout, SceneRun } from '../types/canvas'

function scene(
  _agent_id: string,
  scene_id: string,
  label: string,
  status: SceneRun['status'],
  run_id: string | null,
  overrides: Partial<SceneRun> = {},
): SceneRun {
  return {
    scene_id,
    scene_label: label,
    run_id,
    status,
    attempts: status === 'retrying' ? 2 : 1,
    duration_s: status === 'done' ? 12.4 : null,
    cost: status === 'done' ? 0.0031 : null,
    acceptance_passed: status === 'done' ? true : null,
    logs:
      status === 'done'
        ? ['Starting…', 'Executor returned 2 outputs', 'Acceptance passed']
        : status === 'failed'
        ? ['Starting…', 'ComfyUI timeout after 300s']
        : [],
    inputs: { episode_id: 'ep01', scene_id, phase: 'animation' },
    outputs:
      status === 'done'
        ? [{ name: 'frames', type: 'image', url: '' }]
        : [],
    error: status === 'failed' ? 'ComfyUI timeout after 300s' : null,
    ...overrides,
  }
}

export const SCENE_FANOUTS: Record<string, SceneFanout> = {
  'exec.animation': {
    agent_id: 'exec.animation',
    scenes: [
      scene('exec.animation', 'sc01', 'Scene 01 — Cold Open',      'done',     'run_sc01_anim'),
      scene('exec.animation', 'sc02', 'Scene 02 — Marketplace',    'running',  'run_sc02_anim'),
      scene('exec.animation', 'sc03', 'Scene 03 — Rooftop Chase',  'queued',   null),
      scene('exec.animation', 'sc04', 'Scene 04 — Confrontation',  'failed',   'run_sc04_anim'),
      scene('exec.animation', 'sc05', 'Scene 05 — Resolution',     'retrying', 'run_sc05_anim'),
    ],
  },
  'exec.rigging': {
    agent_id: 'exec.rigging',
    scenes: [
      scene('exec.rigging', 'sc01', 'Scene 01 — Rig Build', 'done', 'run_sc01_rig'),
      scene('exec.rigging', 'sc02', 'Scene 02 — Rig Build', 'done', 'run_sc02_rig'),
    ],
  },
  'orch.showrunner': {
    agent_id: 'orch.showrunner',
    scenes: [
      scene('orch.showrunner', 'ep01', 'Episode 01 — Full Breakdown', 'done', 'run_ep01_show'),
    ],
  },
}
