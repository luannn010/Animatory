// Client-side mesh deform: 2D linear-blend skinning + Canvas2D affine texture
// mapping. The backend produces the bind mesh (vertices/triangles/uvs/weights/
// bindPose); this warps it live and fills each triangle with the source art.
import type { MeshData } from './deformApi'

export interface Sim { a: number; b: number; px: number; py: number; qx: number; qy: number }

/** Similarity (rotate + uniform scale + translate) mapping a bind bone segment to
 *  its current segment. Identity when current == bind. */
export function boneSim(bind: number[], cur: number[]): Sim {
  const vbx = bind[2] - bind[0], vby = bind[3] - bind[1]
  const vcx = cur[2] - cur[0], vcy = cur[3] - cur[1]
  const len2 = vbx * vbx + vby * vby || 1e-6
  return {
    a: (vcx * vbx + vcy * vby) / len2,   // Re(vc / vb)
    b: (vcy * vbx - vcx * vby) / len2,   // Im(vc / vb)
    px: bind[0], py: bind[1], qx: cur[0], qy: cur[1],
  }
}

function applySim(s: Sim, x: number, y: number): [number, number] {
  const dx = x - s.px, dy = y - s.py
  return [s.a * dx - s.b * dy + s.qx, s.b * dx + s.a * dy + s.qy]
}

/** Per-vertex skinned positions: Σ weight_i · sim_i(bindVertex), then optional
 *  manual offsets (free-form sculpt). Returns a flat [x0,y0,x1,y1,...] array. */
export function computeDeformed(
  mesh: MeshData,
  current: Record<string, number[]>,
  offsets?: Map<number, { dx: number; dy: number }>,
): Float64Array {
  const sims: Record<string, Sim> = {}
  for (const id of Object.keys(mesh.bindPose)) {
    sims[id] = boneSim(mesh.bindPose[id], current[id] ?? mesh.bindPose[id])
  }
  const V = mesh.vertices, W = mesh.weights
  const out = new Float64Array(V.length)
  for (let k = 0; k < V.length / 2; k++) {
    const vx = V[k * 2], vy = V[k * 2 + 1]
    const w = W[k]
    let ax = vx, ay = vy
    if (w && w.bones.length) {
      ax = 0; ay = 0
      for (let j = 0; j < w.bones.length; j++) {
        const s = sims[w.bones[j]]
        if (!s) { ax += w.values[j] * vx; ay += w.values[j] * vy; continue }
        const [sx, sy] = applySim(s, vx, vy)
        ax += w.values[j] * sx; ay += w.values[j] * sy
      }
    }
    const off = offsets?.get(k)
    out[k * 2] = ax + (off?.dx ?? 0)
    out[k * 2 + 1] = ay + (off?.dy ?? 0)
  }
  return out
}

/** Affine-map one triangle from texture space (s*) to canvas space (d*), clipped. */
function texTriangle(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource,
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number,
) {
  const e1x = sx1 - sx0, e1y = sy1 - sy0, e2x = sx2 - sx0, e2y = sy2 - sy0
  const D = e1x * e2y - e2x * e1y
  if (Math.abs(D) < 1e-9) return
  const a = ((dx1 - dx0) * e2y - (dx2 - dx0) * e1y) / D
  const c = (e1x * (dx2 - dx0) - e2x * (dx1 - dx0)) / D
  const e = dx0 - a * sx0 - c * sy0
  const b = ((dy1 - dy0) * e2y - (dy2 - dy0) * e1y) / D
  const d = (e1x * (dy2 - dy0) - e2x * (dy1 - dy0)) / D
  const f = dy0 - b * sx0 - d * sy0
  ctx.save()
  ctx.beginPath(); ctx.moveTo(dx0, dy0); ctx.lineTo(dx1, dy1); ctx.lineTo(dx2, dy2); ctx.closePath(); ctx.clip()
  ctx.setTransform(a, b, c, d, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** Fill every triangle with its slice of the source art at the deformed positions.
 *  At bind pose (uv*size == bind vertex) this reproduces the original exactly. */
export function drawTexturedMesh(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement, mesh: MeshData, deformed: Float64Array,
) {
  const tw = img.naturalWidth, th = img.naturalHeight
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const T = mesh.triangles, U = mesh.uvs
  const GROW = 1.012  // expand each triangle slightly around its centroid to hide seams
  for (let i = 0; i < T.length; i += 3) {
    const i0 = T[i], i1 = T[i + 1], i2 = T[i + 2]
    let dx0 = deformed[i0 * 2], dy0 = deformed[i0 * 2 + 1]
    let dx1 = deformed[i1 * 2], dy1 = deformed[i1 * 2 + 1]
    let dx2 = deformed[i2 * 2], dy2 = deformed[i2 * 2 + 1]
    const cx = (dx0 + dx1 + dx2) / 3, cy = (dy0 + dy1 + dy2) / 3
    dx0 = cx + (dx0 - cx) * GROW; dy0 = cy + (dy0 - cy) * GROW
    dx1 = cx + (dx1 - cx) * GROW; dy1 = cy + (dy1 - cy) * GROW
    dx2 = cx + (dx2 - cx) * GROW; dy2 = cy + (dy2 - cy) * GROW
    texTriangle(
      ctx, img,
      U[i0 * 2] * tw, U[i0 * 2 + 1] * th, U[i1 * 2] * tw, U[i1 * 2 + 1] * th, U[i2 * 2] * tw, U[i2 * 2 + 1] * th,
      dx0, dy0, dx1, dy1, dx2, dy2,
    )
  }
}
