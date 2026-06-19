// The textured mesh-deform workspace for ONE character: triangulate → fill
// triangles with the source art (UV texture) → pose by bones (skinning) or
// sculpt vertices. Reused by the standalone /deform page (with a picker) and by
// the Rig Studio's Deform mode. Pure client render over the deform backend.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deformApi, type BindBone, type Density, type MeshData, type MeshParams, type RigAsset, type VertexWeight,
} from './deformApi'
import { computeDeformed, drawTexturedMesh } from './meshDeform'

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

type Joint = { id: string; x: number; y: number }
type BoneRef = { id: string; a: string; b: string }
type Phase = 'idle' | 'generating' | 'done' | 'error'
type View = 'texture' | 'weights' | 'wireframe'
type Interaction = 'pose' | 'sculpt'
type Drag = { type: 'joint'; i: number } | { type: 'vertex'; k: number } | null

function humanoid(w: number, h: number): { joints: Joint[]; bones: BoneRef[] } {
  const J = (id: string, fx: number, fy: number): Joint => ({ id, x: +(fx * w).toFixed(1), y: +(fy * h).toFixed(1) })
  const joints = [
    J('head', 0.5, 0.13), J('chest', 0.5, 0.29), J('hip', 0.5, 0.46),
    J('elbowL', 0.28, 0.34), J('handL', 0.16, 0.4),
    J('elbowR', 0.72, 0.34), J('handR', 0.84, 0.4),
    J('kneeL', 0.4, 0.66), J('footL', 0.38, 0.87),
    J('kneeR', 0.6, 0.66), J('footR', 0.62, 0.87),
  ]
  const bones: BoneRef[] = [
    { id: 'neck', a: 'chest', b: 'head' }, { id: 'spine', a: 'hip', b: 'chest' },
    { id: 'armL_up', a: 'chest', b: 'elbowL' }, { id: 'armL_lo', a: 'elbowL', b: 'handL' },
    { id: 'armR_up', a: 'chest', b: 'elbowR' }, { id: 'armR_lo', a: 'elbowR', b: 'handR' },
    { id: 'legL_up', a: 'hip', b: 'kneeL' }, { id: 'legL_lo', a: 'kneeL', b: 'footL' },
    { id: 'legR_up', a: 'hip', b: 'kneeR' }, { id: 'legR_lo', a: 'kneeR', b: 'footR' },
  ]
  return { joints, bones }
}

function ramp(w: number): string {
  const t = Math.max(0, Math.min(1, w))
  const c = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${c(44, 110)},${c(110, 70)},${c(190, 70)})`
}
function weightOf(vw: VertexWeight | undefined, bone: string): number {
  if (!vw) return 0
  const i = vw.bones.indexOf(bone)
  return i >= 0 ? vw.values[i] : 0
}

const DENSITIES: Density[] = ['coarse', 'medium', 'fine']
const VIEWS: { id: View; label: string }[] = [
  { id: 'texture', label: 'Texture' }, { id: 'weights', label: 'Weights' }, { id: 'wireframe', label: 'Wireframe' },
]

export function DeformWorkspace({ character }: { character: RigAsset }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [texImg, setTexImg] = useState<HTMLImageElement | null>(null)
  const [joints, setJoints] = useState<Joint[]>([])
  const [bones, setBones] = useState<BoneRef[]>([])
  const [density, setDensity] = useState<Density>('medium')
  const [interiorPoints, setInteriorPoints] = useState(true)

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{ stage: string; pct: number }>({ stage: '', pct: 0 })
  const [mesh, setMesh] = useState<MeshData | null>(null)
  const [genErr, setGenErr] = useState('')

  const [view, setView] = useState<View>('texture')
  const [interaction, setInteraction] = useState<Interaction>('pose')
  const [activeBone, setActiveBone] = useState<string | null>(null)
  const [offsets, setOffsets] = useState<Map<number, { dx: number; dy: number }>>(new Map())
  const [activeVertex, setActiveVertex] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag>(null)
  const bindJointsRef = useRef<Joint[]>([])

  useEffect(() => {
    if (!character.imageUrl) { setTexImg(null); return }
    const im = new Image()
    im.onload = () => setTexImg(im)
    im.src = deformApi.imageSrc(character.imageUrl)
    return () => { im.onload = null }
  }, [character.jobId])

  useEffect(() => {
    setDims(null); setMesh(null); setOffsets(new Map()); setActiveBone(null); setActiveVertex(null)
    setPhase('idle'); setGenErr(''); setView('texture'); setInteraction('pose')
  }, [character.jobId])

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    const w = img.naturalWidth, h = img.naturalHeight
    if (dims && dims.w === w && dims.h === h) return
    setDims({ w, h })
    const { joints: js, bones: bs } = humanoid(w, h)
    setJoints(js); setBones(bs)
  }

  const jointById = useMemo(() => new Map(joints.map(j => [j.id, j])), [joints])
  const bindBones = (): BindBone[] => bones.map(b => {
    const a = jointById.get(b.a)!, t = jointById.get(b.b)!
    return { id: b.id, x: a.x, y: a.y, tipX: t.x, tipY: t.y }
  })

  const currentSegments = useMemo(() => {
    const m: Record<string, number[]> = {}
    for (const b of bones) {
      const a = jointById.get(b.a), t = jointById.get(b.b)
      if (a && t) m[b.id] = [a.x, a.y, t.x, t.y]
    }
    return m
  }, [bones, jointById])
  const base = useMemo(() => (mesh ? computeDeformed(mesh, currentSegments) : null), [mesh, currentSegments])
  const final = useMemo(() => {
    if (!base) return null
    if (offsets.size === 0) return base
    const f = base.slice()
    for (const [k, o] of offsets) { f[k * 2] += o.dx; f[k * 2 + 1] += o.dy }
    return f
  }, [base, offsets])

  useEffect(() => {
    if (view !== 'texture' || !mesh || !texImg || !final) return
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) drawTexturedMesh(ctx, texImg, mesh, final)
  }, [view, mesh, texImg, final])

  function toSvg(clientX: number, clientY: number) {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY
    const m = svg.getScreenCTM()
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }
  }
  function onJointDown(i: number, e: React.PointerEvent) {
    if (interaction !== 'pose') return
    e.preventDefault(); e.stopPropagation()
    dragRef.current = { type: 'joint', i }
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* synthetic event */ }
  }
  function onBgDown(e: React.PointerEvent) {
    if (interaction !== 'sculpt' || !final || !dims) return
    const p = toSvg(e.clientX, e.clientY)
    let best = -1, bestD = (dims.w / 45) ** 2
    for (let k = 0; k < final.length / 2; k++) {
      const dx = final[k * 2] - p.x, dy = final[k * 2 + 1] - p.y
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = k }
    }
    if (best >= 0) {
      dragRef.current = { type: 'vertex', k: best }; setActiveVertex(best)
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* synthetic event */ }
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag || !dims) return
    const p = toSvg(e.clientX, e.clientY)
    const x = Math.max(0, Math.min(dims.w, p.x)), y = Math.max(0, Math.min(dims.h, p.y))
    if (drag.type === 'joint') {
      setJoints(js => js.map((j, k) => (k === drag.i ? { ...j, x, y } : j)))
    } else if (base) {
      setOffsets(prev => {
        const m = new Map(prev)
        m.set(drag.k, { dx: x - base[drag.k * 2], dy: y - base[drag.k * 2 + 1] })
        return m
      })
    }
  }
  function onPointerUp() { dragRef.current = null }
  function resetPose() { setJoints(bindJointsRef.current.length ? bindJointsRef.current : joints); setOffsets(new Map()); setActiveVertex(null) }

  function generate() {
    if (!dims) return
    setPhase('generating'); setMesh(null); setOffsets(new Map()); setActiveBone(null); setActiveVertex(null); setGenErr('')
    setProgress({ stage: 'triangulating', pct: 2 })
    const assetId = character.characterId || character.jobId
    const imageRef = (character.imageUrl || '').replace(/^\/outputs\//, '')
    const params: MeshParams = { density, interiorPoints, weightMethod: 'distance-falloff' }
    const snapshot = joints.map(j => ({ ...j }))

    deformApi.generate(assetId, { params, bones: bindBones(), imageRef })
      .then(job => {
        const es = new EventSource(deformApi.streamUrl(assetId, job.jobId))
        let settled = false
        const finish = (m: MeshData) => { if (settled) return; settled = true; es.close(); bindJointsRef.current = snapshot; setMesh(m); setView('texture'); setPhase('done') }
        const fail = (msg: string) => { if (settled) return; settled = true; es.close(); setGenErr(msg); setPhase('error') }
        es.addEventListener('progress', ev => {
          const d = JSON.parse((ev as MessageEvent).data)
          setProgress({ stage: d.stage ?? '…', pct: Math.round((d.progress ?? 0) * 100) })
        })
        es.addEventListener('done', ev => finish(JSON.parse((ev as MessageEvent).data) as MeshData))
        es.addEventListener('error', ev => {
          const data = (ev as MessageEvent).data
          if (data) { try { fail(JSON.parse(data).message || 'mesh generation failed') } catch { fail('mesh generation failed') } }
          else if (!settled) { deformApi.getMesh(assetId).then(m => { if (m?.status === 'rigged') finish(m) }).catch(() => {}) }
        })
      })
      .catch(e => { setGenErr(String(e)); setPhase('error') })
  }

  const stroke = dims ? Math.max(1, dims.w / 600) : 1
  const jointR = dims ? Math.max(5, dims.w / 90) : 6
  const meshBones = mesh ? Object.keys(mesh.bindPose) : []
  const triPolys = useMemo(() => {
    if (!mesh || !final || view === 'texture') return []
    const T = mesh.triangles, out: { pts: string; fill: string }[] = []
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2]
      const pts = `${final[a * 2]},${final[a * 2 + 1]} ${final[b * 2]},${final[b * 2 + 1]} ${final[c * 2]},${final[c * 2 + 1]}`
      let fill = 'none'
      if (view === 'weights' && activeBone) {
        const wAvg = (weightOf(mesh.weights[a], activeBone) + weightOf(mesh.weights[b], activeBone) + weightOf(mesh.weights[c], activeBone)) / 3
        fill = ramp(wAvg)
      }
      out.push({ pts, fill })
    }
    return out
  }, [mesh, final, view, activeBone])

  const posed = mesh && (offsets.size > 0 || joints.some((j, i) => bindJointsRef.current[i] && (j.x !== bindJointsRef.current[i].x || j.y !== bindJointsRef.current[i].y)))

  if (!character.imageUrl) {
    return <p className="p-6 text-sm text-stone">This character has no generated art yet — generate it in the Design track first.</p>
  }

  return (
    <div>
      {/* control bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {mesh && (
          <>
            <div className="flex items-center gap-0.5 rounded-md border border-hairline p-0.5" role="tablist" aria-label="View">
              {VIEWS.map(v => (
                <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${ring} ${view === v.id ? 'bg-[#3772cf] text-white' : 'text-steel hover:bg-surface'}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 rounded-md border border-hairline p-0.5" role="tablist" aria-label="Interaction">
              {(['pose', 'sculpt'] as Interaction[]).map(m => (
                <button key={m} role="tab" aria-selected={interaction === m} onClick={() => setInteraction(m)}
                  className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${ring} ${interaction === m ? 'bg-[#3772cf] text-white' : 'text-steel hover:bg-surface'}`}>
                  {m}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-stone">
            Density
            <select value={density} onChange={e => setDensity(e.target.value as Density)} disabled={phase === 'generating'}
              className={`rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink ${ring}`}>
              {DENSITIES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-stone">
            <input type="checkbox" checked={interiorPoints} onChange={e => setInteriorPoints(e.target.checked)} disabled={phase === 'generating'}
              className={`accent-[#3772cf] ${ring}`} />
            Interior
          </label>
          <button onClick={generate} disabled={!dims || phase === 'generating'}
            className={`rounded-md bg-[#3772cf] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2c5cab] disabled:opacity-50 ${ring}`}>
            {phase === 'generating' ? 'Generating…' : mesh ? 'Regenerate' : 'Generate mesh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
        {/* stage */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative inline-block rounded-lg border border-hairline"
            style={{ backgroundColor: '#fafafa', backgroundImage: 'linear-gradient(#ededed 1px,transparent 1px),linear-gradient(90deg,#ededed 1px,transparent 1px)', backgroundSize: '16px 16px' }}>
            <img src={deformApi.imageSrc(character.imageUrl)} alt="character" onLoad={onImgLoad} draggable={false}
              className="block max-h-[64vh] w-auto rounded-lg transition-opacity"
              style={{ opacity: mesh && view !== 'texture' ? 0.22 : 1 }} />
            {dims && mesh && view === 'texture' && (
              <canvas ref={canvasRef} width={dims.w} height={dims.h} className="absolute inset-0 h-full w-full rounded-lg" />
            )}
            {dims && (
              <svg ref={svgRef} viewBox={`0 0 ${dims.w} ${dims.h}`} className="absolute inset-0 h-full w-full touch-none"
                style={{ cursor: interaction === 'sculpt' && mesh ? 'crosshair' : 'default' }}
                onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
                <rect x={0} y={0} width={dims.w} height={dims.h} fill="transparent" onPointerDown={onBgDown} />
                {triPolys.map((p, i) => (
                  <polygon key={i} points={p.pts} fill={p.fill} fillOpacity={view === 'weights' && activeBone ? 0.6 : 0}
                    stroke="#3772cf" strokeOpacity={0.4} strokeWidth={stroke * 0.6} />
                ))}
                {(interaction === 'pose' || !mesh) && bones.map(b => {
                  const a = jointById.get(b.a)!, t = jointById.get(b.b)!
                  const hot = b.id === activeBone
                  return <line key={b.id} x1={a.x} y1={a.y} x2={t.x} y2={t.y}
                    stroke={hot ? '#00d4a4' : '#3772cf'} strokeWidth={stroke * (hot ? 3 : 2)} strokeLinecap="round" strokeOpacity={0.92} />
                })}
                {(interaction === 'pose' || !mesh) && joints.map((j, i) => (
                  <circle key={j.id} cx={j.x} cy={j.y} r={jointR} fill="#ffffff" stroke="#3772cf" strokeWidth={stroke * 1.5}
                    style={{ cursor: 'grab' }} onPointerDown={e => onJointDown(i, e)}>
                    <title>{j.id}</title>
                  </circle>
                ))}
                {mesh && interaction === 'sculpt' && activeVertex != null && final && (
                  <circle cx={final[activeVertex * 2]} cy={final[activeVertex * 2 + 1]} r={jointR * 0.8}
                    fill="#00d4a4" fillOpacity={0.25} stroke="#00d4a4" strokeWidth={stroke * 1.5} />
                )}
              </svg>
            )}
          </div>
          {mesh && (
            <p className="text-[11px] text-stone">
              {interaction === 'pose' ? 'Drag a joint to pose — the textured mesh deforms by skinning.' : 'Drag anywhere on the mesh to push vertices.'}
            </p>
          )}
        </div>

        {/* inspector */}
        <aside className="space-y-4">
          <div>
            <h2 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-[#3772cf]">Status</h2>
            {phase === 'generating' && (
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-hairline">
                  <div className="h-full rounded-full bg-[#3772cf] transition-[width] duration-150" style={{ width: `${progress.pct}%` }} />
                </div>
                <p className="mt-1.5 font-mono text-xs text-steel">{progress.stage} · {progress.pct}%</p>
              </div>
            )}
            {phase === 'idle' && <p className="text-xs text-stone">Drag the joints to fit the character, then generate the mesh.</p>}
            {phase === 'error' && <p className="text-xs text-brand-error">{genErr}</p>}
            {phase === 'done' && mesh && (
              <p className="text-xs text-stone">
                <span className="font-medium text-[#00b48a]">Rigged.</span>{' '}
                <span className="font-mono">{mesh.vertices.length / 2}</span> verts ·{' '}
                <span className="font-mono">{mesh.triangles.length / 3}</span> tris · v{mesh.version}
              </p>
            )}
          </div>

          {mesh && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[11px] font-mono uppercase tracking-wider text-[#3772cf]">Deform</h2>
                {posed && (
                  <button onClick={resetPose} className={`rounded-md px-2 py-1 text-xs font-medium text-steel hover:bg-surface transition-colors ${ring}`}>
                    Reset
                  </button>
                )}
              </div>
              <p className="text-xs text-stone">
                {interaction === 'pose'
                  ? 'Pose mode — drag the white joints; weighted skinning bends the art at each bone.'
                  : 'Sculpt mode — drag on the mesh to nudge individual vertices on top of the pose.'}
              </p>
            </div>
          )}

          {mesh && view === 'weights' && (
            <div>
              <h2 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-[#3772cf]">Weights</h2>
              <p className="mb-2 text-xs text-stone">Pick a bone to tint the mesh by its influence.</p>
              <div className="flex flex-wrap gap-1">
                {meshBones.map(b => (
                  <button key={b} onClick={() => setActiveBone(activeBone === b ? null : b)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors ${ring} ${
                      activeBone === b ? 'border-[#3772cf] bg-[#3772cf]/10 text-[#3772cf]' : 'border-hairline text-steel hover:bg-surface'
                    }`}>{b}</button>
                ))}
              </div>
              {activeBone && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[10px] text-stone">0</span>
                  <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(0.5)}, ${ramp(1)})` }} />
                  <span className="text-[10px] text-stone">1</span>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
