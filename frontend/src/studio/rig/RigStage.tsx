// Interactive rig stage — the editor's direct-manipulation surface.
//
// Mirrors the Animatory Design System's rig studio prototype, wired to the real
// FK + reducer instead of the prototype's local state:
//   • Pose mode  — drag a bone's tip handle to rotate it (FK; children follow).
//   • Draw mode  — drag from a joint (snaps) or empty space to grow a new bone;
//                  an accent rubber-band previews the draft until release.
//   • Playback   — while `live`, the skeleton renders in teal and is read-only.
// The component owns SVG geometry only; the reducer owns the data model, so it
// reports edits up via `onPoseBone` (rest-relative delta) and `onDrawBone`.
import { useEffect, useRef, useState } from 'react'
import type { Bone, RigMode } from '../types'
import { resolveSkeleton, type Pose } from './fk'
import { SKIN_WIDTHS, SKIN_HEAD, SKIN_FILL } from './humanoid'

// Respect the user's motion preference for the selected-handle pulse.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

export interface DrawnBone {
  parent: string | null
  x: number
  y: number
  len: number
  angle: number // absolute radians
}

interface Props {
  bones: Bone[]
  pose: Pose
  selectedBoneId: string | null
  onSelectBone: (id: string) => void
  mode: RigMode
  /** Playing or scrubbing — skeleton turns teal and editing is locked. */
  live?: boolean
  /** Draw-bone tool armed (rig mode only). */
  drawing?: boolean
  /** Report a new rest-relative pose delta (radians) for a bone. */
  onPoseBone?: (id: string, delta: number) => void
  /** Report a freshly drawn bone's geometry; the view assigns id/name. */
  onDrawBone?: (geom: DrawnBone) => void
}

const VB_W = 600
const VB_H = 600
const SNAP = 24 // svg units — a draw-start within this of a tip snaps to it
const MIN_LEN = 12 // shorter drags read as a click, not a bone

interface Draft {
  start: { x: number; y: number }
  cur: { x: number; y: number }
  parent: string | null
  snapped: boolean
}

export function RigStage({
  bones, pose, selectedBoneId, onSelectBone, mode,
  live = false, drawing = false, onPoseBone, onDrawBone,
}: Props) {
  const resolved = resolveSkeleton(bones, pose)
  const byId = new Map(bones.map(b => [b.id, b]))
  const reducedMotion = usePrefersReducedMotion()

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<string | null>(null) // bone being posed
  const drawRef = useRef<Draft | null>(null)  // draw-in-progress
  const [draft, setDraft] = useState<Draft | null>(null)

  const canDraw = drawing && mode === 'rig' && !live
  const canPose = mode === 'pose' && !live

  // ── pointer → svg coordinate space ──
  function toSvg(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  // nearest bone tip within SNAP — the joint a new child grows from
  function nearestJoint(p: { x: number; y: number }) {
    let best: { parent: string; point: { x: number; y: number } } | null = null
    let bd = SNAP
    for (const b of bones) {
      const r = resolved.get(b.id)
      if (!r) continue
      const d = Math.hypot(r.tipX - p.x, r.tipY - p.y)
      if (d < bd) { bd = d; best = { parent: b.id, point: { x: r.tipX, y: r.tipY } } }
    }
    return best
  }

  function startDraw(e: React.PointerEvent) {
    const p = toSvg(e)
    const snap = nearestJoint(p)
    const d: Draft = { start: snap ? snap.point : p, cur: p, parent: snap?.parent ?? null, snapped: !!snap }
    drawRef.current = d
    setDraft(d)
    try { svgRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }

  function startPose(id: string, e: React.PointerEvent) {
    dragRef.current = id
    try { svgRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }

  function onStageDown(e: React.PointerEvent) {
    if (canDraw) startDraw(e)
  }

  function onHandleDown(id: string) {
    return (e: React.PointerEvent) => {
      e.stopPropagation()
      if (canDraw) { startDraw(e); return } // grow a child from this joint
      onSelectBone(id)
      if (canPose) startPose(id, e)
    }
  }

  function onStageMove(e: React.PointerEvent) {
    if (drawRef.current) {
      const cur = toSvg(e)
      setDraft(d => (d ? { ...d, cur } : d))
      return
    }
    const id = dragRef.current
    if (!id || !onPoseBone) return
    const r = resolved.get(id)
    const bone = byId.get(id)
    if (!r || !bone) return
    const m = toSvg(e)
    const parent = bone.parent ? byId.get(bone.parent) : undefined
    const parentResolvedAngle = parent ? (resolved.get(parent.id)?.angle ?? 0) : 0
    const restRel = bone.angle - (parent?.angle ?? 0)
    const desiredAbs = Math.atan2(m.y - r.y, m.x - r.x)
    onPoseBone(id, desiredAbs - parentResolvedAngle - restRel)
  }

  function endStage() {
    const d = drawRef.current
    drawRef.current = null
    dragRef.current = null
    if (d && onDrawBone) {
      const len = Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y)
      if (len >= MIN_LEN) {
        const drawnAbs = Math.atan2(d.cur.y - d.start.y, d.cur.x - d.start.x)
        // Convert the drawn (posed-space) angle into the bone's REST absolute
        // angle, so FK places it where it was dragged even off a posed parent.
        const parent = d.parent ? byId.get(d.parent) : undefined
        const parentPoseDelta = parent ? (resolved.get(parent.id)?.angle ?? 0) - parent.angle : 0
        onDrawBone({
          parent: d.parent,
          x: d.start.x,
          y: d.start.y,
          len: Math.round(len),
          angle: drawnAbs - parentPoseDelta,
        })
      }
    }
    setDraft(null)
  }

  const cursor = canDraw ? 'cursor-crosshair' : canPose ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
  const modeLabel = live ? 'Playback' : canDraw ? 'Draw' : mode === 'pose' ? 'Pose' : 'Rig'
  const hint = bones.length === 0
    ? (canDraw ? 'Drag anywhere on the stage to lay down your first bone.' : null)
    : canDraw ? 'Drag from a joint to grow a child bone, or from empty space for a new root.'
    : mode === 'pose' ? 'Drag a tip handle to rotate a bone — children follow.'
    : 'Select a bone, then switch to Pose to move it or turn on Draw bone to add.'

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0f1419]">
      <div className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0c1116]/70 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-white/70 backdrop-blur-sm">
        <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-[#00d4a4]' : 'bg-[#3772cf]'}`} />
        <span className="text-white/90">{modeLabel}</span> mode
      </div>

      {bones.length === 0 && !canDraw ? (
        <div className="grid h-full place-items-center px-6 text-center">
          <p className="max-w-[280px] text-sm text-white/55">
            No skeleton yet. Turn on <span className="font-medium text-white/80">Draw bone</span> and drag on the
            stage, or <span className="font-medium text-white/80">Import character</span> to load a humanoid rig.
          </p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label="Rig stage"
          className={`block h-full w-full ${cursor}`}
          style={{ touchAction: 'none' }}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={endStage}
          onPointerLeave={endStage}
        >
          <defs>
            <pattern id="rigGrid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M30 0H0V30" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#rigGrid)" />
          <line x1={VB_W / 2} y1="0" x2={VB_W / 2} y2={VB_H} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

          {/* soft "skin" silhouette — stands in for imported character art and
              deforms with the default humanoid. Only the named bones carry skin,
              so a hand-drawn skeleton shows none. */}
          <g opacity={live ? 0.22 : 0.16}>
            {bones.map(b => {
              const w = SKIN_WIDTHS[b.id]
              const r = w ? resolved.get(b.id) : undefined
              if (!r) return null
              return (
                <line key={b.id} x1={r.x} y1={r.y} x2={r.tipX} y2={r.tipY}
                  stroke={SKIN_FILL} strokeWidth={w} strokeLinecap="round" />
              )
            })}
            {(() => {
              const head = resolved.get(SKIN_HEAD.boneId)
              return head ? <circle cx={head.tipX} cy={head.tipY} r={SKIN_HEAD.r} fill={SKIN_FILL} /> : null
            })()}
          </g>

          {/* bone shafts (tapered) + pivots */}
          {bones.map(b => {
            const r = resolved.get(b.id)
            if (!r) return null
            const sel = b.id === selectedBoneId
            const col = live ? 'rgba(0,212,164,0.85)' : sel ? '#5689d8' : 'rgba(206,216,226,0.55)'
            return (
              <g key={b.id}>
                <polygon points={taper(r.x, r.y, r.tipX, r.tipY, sel ? 7 : 5.5, 2)} fill={col} opacity={sel ? 0.95 : 0.6} />
                <circle cx={r.x} cy={r.y} r={sel ? 4.5 : 3.5} fill="#0f1419" stroke={col} strokeWidth="1.6" />
              </g>
            )
          })}

          {/* tip handles — pose / draw-from control */}
          {bones.map(b => {
            const r = resolved.get(b.id)
            if (!r) return null
            const sel = b.id === selectedBoneId
            const interactive = canPose || canDraw
            return (
              <g key={b.id} onPointerDown={onHandleDown(b.id)} className={interactive ? cursor : 'cursor-pointer'}>
                <circle cx={r.tipX} cy={r.tipY} r="11" fill="transparent" />
                <circle cx={r.tipX} cy={r.tipY} r={sel ? 6.5 : 5}
                  fill={sel ? '#3772cf' : '#ffffff'}
                  stroke={live ? '#00d4a4' : sel ? '#84a8e0' : 'rgba(15,20,25,0.45)'}
                  strokeWidth={sel ? 2.5 : 1.5}>
                  {sel && !live && !drawing && !reducedMotion && (
                    <animate attributeName="r" values="6.5;7.2;6.5" dur="1.8s" repeatCount="indefinite" />
                  )}
                </circle>
              </g>
            )
          })}

          {/* draft rubber-band while drawing */}
          {draft && (() => {
            const len = Math.hypot(draft.cur.x - draft.start.x, draft.cur.y - draft.start.y)
            return (
              <g pointerEvents="none">
                {draft.snapped && (
                  <circle cx={draft.start.x} cy={draft.start.y} r="9" fill="none" stroke="#3772cf" strokeWidth="2" opacity="0.85" />
                )}
                <line x1={draft.start.x} y1={draft.start.y} x2={draft.cur.x} y2={draft.cur.y}
                  stroke="#3772cf" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={len < MIN_LEN ? '2 5' : undefined} />
                <circle cx={draft.start.x} cy={draft.start.y} r="3.5" fill="#3772cf" />
                <circle cx={draft.cur.x} cy={draft.cur.y} r="5.5" fill="#ffffff" stroke="#3772cf" strokeWidth="2" />
              </g>
            )
          })()}
        </svg>
      )}

      {hint && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 text-center text-[11px] text-white/45">
          {hint}
        </p>
      )}
    </div>
  )
}

// Tapered quad from (sx,sy) width w1 to (tx,ty) width w2 — the bone shaft.
function taper(sx: number, sy: number, tx: number, ty: number, w1: number, w2: number): string {
  const dx = tx - sx, dy = ty - sy
  const L = Math.hypot(dx, dy) || 1
  const nx = -dy / L, ny = dx / L
  return [
    `${sx + nx * w1},${sy + ny * w1}`,
    `${tx + nx * w2},${ty + ny * w2}`,
    `${tx - nx * w2},${ty - ny * w2}`,
    `${sx - nx * w1},${sy - ny * w1}`,
  ].join(' ')
}
