import type { Phase, Project } from './types'

export const PHASE_ORDER: Phase[] = ['parse', 'pre', 'vendor', 'post']

export const PHASE_META: Record<Phase, { label: string; short: string }> = {
  parse:  { label: 'Parse',           short: 'Parse' },
  pre:    { label: 'Pre-production',  short: 'Pre-prod' },
  vendor: { label: 'Vendor Studio',   short: 'Vendor' },
  post:   { label: 'Post-production', short: 'Post' },
}

export function phasePath(projectId: string, phase: Phase): string {
  return `/project/${projectId}/${phase}`
}

export function isPhaseReachable(project: Project, phase: Phase): boolean {
  return project.phases[phase] !== 'locked'
}
