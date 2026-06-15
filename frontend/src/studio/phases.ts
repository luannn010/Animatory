import type { Phase, Project, TrackId } from './types'

export const PHASE_ORDER: Phase[] = ['script', 'pre', 'production', 'post']

export const PHASE_META: Record<Phase, { label: string; short: string }> = {
  script:     { label: 'Script',          short: 'Script' },
  pre:        { label: 'Pre-production',  short: 'Pre' },
  production: { label: 'Production',      short: 'Production' },
  post:       { label: 'Post-production', short: 'Post' },
}

export const PRE_TRACKS: TrackId[] = ['design', 'storyboard', 'audio']

// The URL segment can differ from the phase id (the script phase keeps the
// legacy `/parse` route; production replaces the old `/vendor`).
const PHASE_PATH: Record<Phase, string> = {
  script: 'parse',
  pre: 'pre',
  production: 'production',
  post: 'post',
}

export function phasePath(projectId: string, phase: Phase): string {
  return `/project/${projectId}/${PHASE_PATH[phase]}`
}

export function preTrackPath(projectId: string, track: TrackId | 'animatic' | 'checking'): string {
  return `/project/${projectId}/pre/${track}`
}

export function isPhaseReachable(project: Project, phase: Phase): boolean {
  return project.gates[phase] !== 'locked'
}

/** Whether a project may advance past `from`. The `pre` gate requires all three
 *  parallel tracks ready; other phases have no track gate yet. */
export function canAdvance(project: Project, from: Phase): boolean {
  if (from === 'pre') {
    return PRE_TRACKS.every(t => project.preTracks[t].status === 'ready')
  }
  return true
}
