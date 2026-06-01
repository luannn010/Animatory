const COL = [0, 320, 640, 960]
const ROW_H = 130

export const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  'orch.showrunner':    { x: COL[0], y: 0 },
  'orch.editor_retake': { x: COL[0], y: ROW_H },
  'gate.checking':      { x: COL[0], y: ROW_H * 2 },
  'design.lineart':     { x: COL[1], y: 0 },
  'design.color':       { x: COL[1], y: ROW_H },
  'design.mouthchart':  { x: COL[1], y: ROW_H * 2 },
  'board.storyboard':   { x: COL[1], y: ROW_H * 3 },
  'cast.dialogue':      { x: COL[1], y: ROW_H * 4 },
  'post.adr':           { x: COL[1], y: ROW_H * 5 },
  'exec.rigging':       { x: COL[2], y: 0 },
  'exec.animation':     { x: COL[2], y: ROW_H },
  'exec.vfx':           { x: COL[2], y: ROW_H * 2 },
  'post.composer':      { x: COL[3], y: 0 },
  'post.sfx':           { x: COL[3], y: ROW_H },
  'exec.mix_deliver':   { x: COL[3], y: ROW_H * 2 },
}

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 110
