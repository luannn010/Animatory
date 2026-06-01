import type { Edge } from '@xyflow/react'

export const PIPELINE_EDGES: Edge[] = [
  { id: 'e-show-lineart',   source: 'orch.showrunner',    target: 'design.lineart',     animated: false },
  { id: 'e-show-board',     source: 'orch.showrunner',    target: 'board.storyboard',   animated: false },
  { id: 'e-show-cast',      source: 'orch.showrunner',    target: 'cast.dialogue',      animated: false },
  { id: 'e-lineart-color',  source: 'design.lineart',     target: 'design.color',       animated: false },
  { id: 'e-lineart-mouth',  source: 'design.lineart',     target: 'design.mouthchart',  animated: false },
  { id: 'e-lineart-rig',    source: 'design.lineart',     target: 'exec.rigging',       animated: false },
  { id: 'e-rig-anim',       source: 'exec.rigging',       target: 'exec.animation',     animated: false },
  { id: 'e-board-anim',     source: 'board.storyboard',   target: 'exec.animation',     animated: false },
  { id: 'e-cast-anim',      source: 'cast.dialogue',      target: 'exec.animation',     animated: false },
  { id: 'e-mouth-anim',     source: 'design.mouthchart',  target: 'exec.animation',     animated: false },
  { id: 'e-anim-vfx',       source: 'exec.animation',     target: 'exec.vfx',           animated: false },
  { id: 'e-anim-editor',    source: 'exec.animation',     target: 'orch.editor_retake', animated: false },
  { id: 'e-vfx-mix',        source: 'exec.vfx',           target: 'exec.mix_deliver',   animated: false },
  { id: 'e-adr-mix',        source: 'post.adr',           target: 'exec.mix_deliver',   animated: false },
  { id: 'e-comp-mix',       source: 'post.composer',      target: 'exec.mix_deliver',   animated: false },
  { id: 'e-sfx-mix',        source: 'post.sfx',           target: 'exec.mix_deliver',   animated: false },
  { id: 'e-cast-adr',       source: 'cast.dialogue',      target: 'post.adr',           animated: false },
  { id: 'e-editor-gate',    source: 'orch.editor_retake', target: 'gate.checking',      animated: false },
  { id: 'e-mix-gate',       source: 'exec.mix_deliver',   target: 'gate.checking',      animated: false },
]
