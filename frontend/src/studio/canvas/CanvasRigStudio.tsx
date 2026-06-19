// Rig Studio — the Canvas track's animation editor (Step 2a: core).
// Full-flush. Tool rail · Characters dock · canvas (pose/zoom/pan) · extendable
// keyframe timeline (transport, presence bands, playback) · right widget.
// Multi-track clip authoring + the 5 generators + picker modals are Step 2b.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../api'
import { Icon, type IconName } from '../ui/Icon'
import { Glyph, GLYPH } from './studioGlyphs'
import { StatusPill } from './StatusPill'
import { type CanvasScene, type CanvasShot, sceneById, shotById, charById, locById, type LibEntry } from './canvasData'

const FPS = 24
const ROW = 26
// Full-flush breakout: pins the studio to the content region (right of the 208px
// studio nav, below the 60px app header), like the rig editor. (.ppc-studio is a
// grid, so a fixed grid fills the region directly — no flex wrapper needed.)
const STUDIO_FIXED = 'fixed left-52 top-[60px] right-0 bottom-0 z-10'
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const hashId = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h }
const KIND_GLYPH: Record<string, IconName> = { character: 'user', location: 'map-pin', prop: 'package' }

interface Layer { uid: string; id: string; name: string; x: number; y: number; inT: number; outT: number; visible: boolean }
interface Key { t: number; x: number; y: number }
type Tool = 'cursor' | 'pose' | 'hand' | 'zoom' | 'comment'

// ── small presentational parts ────────────────────────────────────────────────
function PaperPlate({ id, kind = 'character' }: { id: string; kind?: 'character' | 'location' | 'prop' }) {
  const hue = hashId(id || kind) % 360
  return (
    <div style={{ width: '100%', height: '100%', background: `hsl(${hue} 34% 87%)`, display: 'grid', placeItems: 'center', color: `hsl(${hue} 26% 46%)` }}>
      <Icon name={KIND_GLYPH[kind] || 'image'} size={20} />
    </div>
  )
}

function FigureLayer({ id, label, active, x, y, dragging, off, onDown }: {
  id: string; label: string; active: boolean; x: number; y: number; dragging: boolean; off: boolean
  onDown: (e: React.PointerEvent) => void
}) {
  const hue = hashId(id) % 360
  return (
    <div className={`ppc-stage__layer${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${off ? ' is-off' : ''}`}
      style={{ left: `${x}%`, top: `${y}%`, width: 64, height: 124, transform: 'translateX(-50%)' }} onPointerDown={onDown}>
      {off && <span className="ppc-offbadge">off-screen</span>}
      <svg viewBox="0 0 64 124" width="64" height="124" style={{ display: 'block', pointerEvents: 'none' }} aria-hidden="true">
        <g stroke="var(--ink)" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.62">
          <ellipse cx="32" cy="18" rx="11" ry="13" fill={`hsl(${hue} 30% 86%)`} />
          <path d="M32 31 V76 M32 43 L15 61 M32 43 L49 61 M32 76 L20 110 M32 76 L44 110" />
        </g>
      </svg>
      <div style={{ textAlign: 'center', marginTop: 2, fontFamily: 'var(--ppc-mono)', fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', pointerEvents: 'none' }}>{label}</div>
    </div>
  )
}

function Dropdown({ label, value, valueId, options, onPick }: {
  label: string; value: string; valueId: string
  options: { id: string; label: string }[]; onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [open])
  return (
    <div className={`ppc-dd${open ? ' is-open' : ''}`} ref={ref}>
      <button className="ppc-dd__btn" onClick={() => setOpen(o => !o)}>
        <span className="ppc-eyebrow" style={{ color: 'var(--muted)' }}>{label}</span>
        <span>{value}</span>
        <span className="ppc-id">{valueId}</span>
        <Icon name="chevron-down" size={14} className="chev" />
      </button>
      {open && (
        <div className="ppc-dd__menu">
          {options.map(o => (
            <button key={o.id} className={`ppc-dd__opt${o.id === valueId ? ' is-sel' : ''}`} onClick={() => { setOpen(false); onPick(o.id) }}>
              <span>{o.label}</span><span className="ppc-id">{o.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function interpKeys(keys: Key[], u: number): { x: number; y: number } | null {
  if (!keys.length) return null
  if (u <= keys[0].t) return keys[0]
  const last = keys[keys.length - 1]
  if (u >= last.t) return last
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (u >= a.t && u <= b.t) { const f = (u - a.t) / (b.t - a.t || 1); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f } }
  }
  return last
}

const RAIL: { id: string; icon?: IconName; glyph?: keyof typeof GLYPH; title: string }[] = [
  { id: 'script', glyph: 'script', title: 'Script' },
  { id: 'actions', icon: 'sparkles', title: 'Actions' },
  { id: 'voices', icon: 'mic', title: 'Voices' },
  { id: 'fx', glyph: 'fx', title: 'Effects & Sound FX' },
  { id: 'objects', icon: 'package', title: 'Objects' },
]

// ── studio body (remounts per shot via key, resetting all editor state) ───────
function StudioBody({ projectId, scenes, scene, shot }: { projectId: string; scenes: CanvasScene[]; scene: CanvasScene; shot: CanvasShot }) {
  const navigate = useNavigate()
  const durSec = parseFloat(shot.duration) || 4
  const frames = Math.max(1, Math.round(durSec * FPS))
  const minLen = 2 / frames
  const snapT = (t: number) => Math.round(t * frames) / frames

  const [layers, setLayers] = useState<Layer[]>(() =>
    shot.characters.map((cid, i) => {
      const c = charById(cid) || { id: cid, name: cid }
      return { uid: `${cid}_${i}`, id: cid, name: c.name, x: 36 + i * 28, y: 24, inT: 0, outT: 1, visible: true }
    }))
  const [active, setActive] = useState<string | null>(shot.characters[0] ? `${shot.characters[0]}_0` : null)
  const background = locById(scene.locationId) || null
  const [tool, setTool] = useState<Tool>('pose')
  const [panel, setPanel] = useState<string | null>('script')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [kf, setKf] = useState<Record<string, Key[]>>({})
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [tlH, setTlH] = useState(214)
  const [order, setOrder] = useState<string[]>([])
  const [hiddenBg, setHiddenBg] = useState(false)
  const [selPres, setSelPres] = useState<string | null>(null) // selected presence-band layer uid
  const [dragOver, setDragOver] = useState<string | null>(null)

  const rafRef = useRef(0)
  const dragRef = useRef<{ uid: string } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const tlDragRef = useRef<{ sy: number; h: number } | null>(null)
  const presDragRef = useRef<{ uid: string; mode: 'move' | 'l' | 'r'; startX: number; inT: number; outT: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // playback — advance the playhead; figures interpolate from their keyframes
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now
      setTime(t => { let n = t + dt / durSec; if (n >= 1) { if (loop) n %= 1; else { n = 1; setPlaying(false) } } return n })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, loop, durSec])

  const activeLayer = layers.find(l => l.uid === active) ?? null
  const live = playing || scrubbing
  const curFrame = Math.round(time * frames)
  const sceneNo = `Scene ${scene.id.split('-')[1] ?? ''}`
  const shotNo = `Shot ${shot.id.slice(-3)}`
  const onStage = (l: Layer) => l.visible !== false && time >= l.inT - 1e-6 && time <= l.outT + 1e-6
  const dispPos = (l: Layer) => {
    const keys = kf[l.uid]
    if (live && keys && keys.length) { const p = interpKeys(keys, time); if (p) return p }
    return { x: l.x, y: l.y }
  }

  // ── pose: drag a figure on the canvas (Pose tool) ──
  const onLayerDown = (uid: string) => (e: React.PointerEvent) => {
    e.stopPropagation(); setActive(uid)
    if (live || tool !== 'pose') return
    dragRef.current = { uid }
    try { canvasRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }
  const onCanvasMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d || !canvasRef.current) return
    const r = canvasRef.current.getBoundingClientRect()
    const x = clamp(((e.clientX - r.left) / r.width) * 100, 6, 94)
    const y = clamp(((e.clientY - r.top) / r.height) * 100 - 20, 2, 74)
    setLayers(ls => ls.map(l => (l.uid === d.uid ? { ...l, x, y } : l)))
  }
  const onCanvasUp = () => { dragRef.current = null }

  // ── zoom / pan ──
  const setZoomC = (z: number) => setZoom(clamp(z, 0.4, 3))
  const onWrapWheel = (e: React.WheelEvent) => { if (tool !== 'zoom' && !e.ctrlKey && !e.metaKey) return; setZoomC(zoom * (e.deltaY < 0 ? 1.1 : 0.9)) }
  const onWrapDown = (e: React.PointerEvent) => { if (tool !== 'hand') return; panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  const onWrapMove = (e: React.PointerEvent) => { const d = panRef.current; if (!d) return; setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }) }
  const onWrapUp = () => { panRef.current = null }
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  // ── keyframes ──
  const addKeyframe = () => {
    if (!activeLayer) return
    setKf(m => {
      const cur = (m[active!] || []).filter(k => Math.abs(k.t - time) > 0.015)
      cur.push({ t: time, x: activeLayer.x, y: activeLayer.y }); cur.sort((a, b) => a.t - b.t)
      return { ...m, [active!]: cur }
    })
  }
  const activeKeys = active ? (kf[active] || []) : []
  const prevKey = () => { const c = [...activeKeys].reverse().find(k => k.t < time - 0.002); setPlaying(false); setTime(c ? c.t : 0) }
  const nextKey = () => { const c = activeKeys.find(k => k.t > time + 0.002); setPlaying(false); setTime(c ? c.t : 1) }

  // ── transport / scrub ──
  const togglePlay = () => { if (time >= 1) setTime(0); setPlaying(p => !p) }
  const seekFromEl = (el: HTMLElement, clientX: number) => { const r = el.getBoundingClientRect(); setTime(clamp((clientX - r.left) / r.width, 0, 1)) }
  const stepFrame = (d: number) => { setPlaying(false); setTime(t => clamp(t + d / frames, 0, 1)) }
  const lanesDown = (e: React.PointerEvent) => { setSelPres(null); setPlaying(false); setScrubbing(true); seekFromEl(lanesRef.current!, e.clientX); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  const lanesMove = (e: React.PointerEvent) => {
    const pd = presDragRef.current
    if (pd && lanesRef.current) {
      const r = lanesRef.current.getBoundingClientRect()
      const df = (e.clientX - pd.startX) / r.width
      let inT = pd.inT, outT = pd.outT
      if (pd.mode === 'move') { const w = pd.outT - pd.inT; inT = clamp(pd.inT + df, 0, 1 - w); outT = inT + w }
      else if (pd.mode === 'l') inT = clamp(pd.inT + df, 0, pd.outT - minLen)
      else if (pd.mode === 'r') outT = clamp(pd.outT + df, pd.inT + minLen, 1)
      setLayers(ls => ls.map(l => (l.uid === pd.uid ? { ...l, inT: snapT(inT), outT: snapT(outT) } : l)))
      return
    }
    if (scrubbing) seekFromEl(lanesRef.current!, e.clientX)
  }
  const lanesUp = () => { presDragRef.current = null; setScrubbing(false) }
  const presDown = (uid: string, mode: 'move' | 'l' | 'r') => (e: React.PointerEvent) => {
    e.stopPropagation()
    const l = layers.find(x => x.uid === uid); if (!l) return
    setActive(uid); setSelPres(uid); setPlaying(false)
    presDragRef.current = { uid, mode, startX: e.clientX, inT: l.inT, outT: l.outT }
    try { lanesRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }

  // ── timeline resize ──
  const tlDown = (e: React.PointerEvent) => { tlDragRef.current = { sy: e.clientY, h: tlH }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  const tlMove = (e: React.PointerEvent) => { const d = tlDragRef.current; if (!d) return; setTlH(clamp(d.h + (d.sy - e.clientY), 150, 440)) }
  const tlUp = () => { tlDragRef.current = null }

  const updateLayer = (uid: string, patch: Partial<Layer>) => setLayers(ls => ls.map(l => (l.uid === uid ? { ...l, ...patch } : l)))
  const toggleVisible = (uid: string) => setLayers(ls => ls.map(l => (l.uid === uid ? { ...l, visible: !l.visible } : l)))

  // ── ordered tracks (characters + background), reorderable ──
  type Track = { key: string; kind: 'character' | 'background'; name: string; layer?: Layer }
  const base: Track[] = [
    ...layers.map(l => ({ key: l.uid, kind: 'character' as const, name: l.name, layer: l })),
    { key: 'bg', kind: 'background' as const, name: background ? background.name : 'Background' },
  ]
  const tracks: Track[] = (() => {
    const byKey = Object.fromEntries(base.map(t => [t.key, t]))
    const seen = new Set<string>(); const out: Track[] = []
    order.forEach(k => { if (byKey[k] && !seen.has(k)) { out.push(byKey[k]); seen.add(k) } })
    base.forEach(t => { if (!seen.has(t.key)) out.push(t) })
    return out
  })()
  const reorderTrack = (src: string, dst: string) => {
    if (src === dst) return
    const keys = tracks.map(t => t.key).filter(k => k !== src)
    const di = keys.indexOf(dst); keys.splice(di < 0 ? keys.length : di, 0, src); setOrder(keys)
  }

  const ruleStep = frames > 60 ? 12 : 6
  const ticks: number[] = []; for (let f = 0; f <= frames; f += ruleStep) ticks.push(f)

  const scenePlate = (l: Layer) => `hsl(${hashId(l.id) % 360} 42% 46%)`
  const goStudio = (sid: string, shid: string) => navigate(`/project/${projectId}/pre/canvas/${sid}/${shid}/studio`)

  return (
    <div className={`ppc ppc-studio ${STUDIO_FIXED}${playing ? ' is-playing' : ''}`}>
      {/* BAR */}
      <div className="ppc-studio__bar">
        <Dropdown label="Scene" value={sceneNo} valueId={scene.id}
          options={scenes.map(s => ({ id: s.id, label: `Scene ${s.id.split('-')[1]}` }))}
          onPick={sid => { const s = sceneById(scenes, sid); goStudio(sid, s.shots[0].id) }} />
        <span style={{ display: 'inline-flex', color: 'var(--faint)' }}><Icon name="chevron-right" size={15} /></span>
        <Dropdown label="Shot" value={shotNo} valueId={shot.id}
          options={scene.shots.map(sh => ({ id: sh.id, label: `Shot ${sh.id.slice(-3)}` }))}
          onPick={shid => goStudio(scene.id, shid)} />
        <div className="ppc-crumb" style={{ marginLeft: 14 }}>
          <span>Project</span><span className="ppc-crumb__sep">/</span><b>{sceneNo}</b>
          <span className="ppc-crumb__sep">/</span><b>{shotNo}</b>
        </div>
        <StatusPill status={shot.status} />
        <button className="ppc-back" onClick={() => navigate(`/project/${projectId}/pre/canvas/${scene.id}`)}>
          <Icon name="chevron-right" size={15} className="rotate-180" /> Back to Board
        </button>
      </div>

      {/* TOOL RAIL */}
      <div className="ppc-toolrail">
        {([['cursor', 'cursor', 'Select'], ['pose', 'move', 'Pose / move'], ['hand', 'hand', 'Pan'], ['zoom', 'zoom', 'Zoom']] as const).map(([id, g, title]) => (
          <button key={id} className={`ppc-tool2${tool === id ? ' is-on' : ''}`} title={title} onClick={() => setTool(id)}><Glyph d={GLYPH[g]} /></button>
        ))}
        <div className="ppc-toolrail__sep" />
        <button className="ppc-tool2" title="Add keyframe" onClick={addKeyframe} disabled={!activeLayer}><Glyph d={GLYPH.diamond} /></button>
        <button className={`ppc-tool2${tool === 'comment' ? ' is-on' : ''}`} title="Annotate" onClick={() => setTool('comment')}><Glyph d={GLYPH.comment} /></button>
        <div className="ppc-toolrail__spacer" />
        <div className="ppc-swatch" title="Ink / paper"><span className="ppc-swatch__sq ppc-swatch__bg" /><span className="ppc-swatch__sq ppc-swatch__fg" /></div>
      </div>

      {/* CHARACTERS dock */}
      <aside className="ppc-dock ppc-dock--l">
        <div className="ppc-dock__head"><Icon name="user" size={15} /><span className="ppc-eyebrow">Characters</span></div>
        <div className="ppc-dock__body">
          <button className="ppc-btn is-sm" disabled title="Import picker — Step 2b"><Icon name="plus" size={14} /> Import Character</button>
          {layers.map(l => (
            <div key={l.uid} className={`ppc-layer${active === l.uid ? ' is-active' : ''}`} onClick={() => setActive(l.uid)}>
              <div className="ppc-layer__thumb"><PaperPlate id={l.id} kind="character" /></div>
              <div style={{ minWidth: 0 }}>
                <div className="ppc-layer__name">{l.name}</div>
                <div className="ppc-layer__kind">layer</div>
              </div>
              <button className={`ppc-layer__eye${l.visible ? '' : ' is-off'}`} title={l.visible ? 'Hide layer' : 'Show layer'}
                onClick={e => { e.stopPropagation(); toggleVisible(l.uid) }}><Icon name="eye" size={14} /></button>
            </div>
          ))}
          {layers.length === 0 && <div className="ppc-empty-note">No characters staged in this shot.</div>}
        </div>
      </aside>

      {/* CENTER — canvas + timeline */}
      <div className="ppc-center">
        <div className={`ppc-canvaswrap${tool === 'hand' ? (panRef.current ? ' is-panning' : ' is-pan') : ''}`}
          onWheel={onWrapWheel} onPointerDown={onWrapDown} onPointerMove={onWrapMove} onPointerUp={onWrapUp} onPointerLeave={onWrapUp}>
          <div className="ppc-canvas ppc-hatch" ref={canvasRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerLeave={onCanvasUp}>
            <span className="ppc-stage__badge"><Icon name="film" size={12} /> {(background ? 1 : 0) + layers.length} layers · 16:9</span>

            {background && !hiddenBg
              ? <div className="ppc-stage__bg"><PaperPlate id={background.id} kind="location" /></div>
              : !background && <div className="ppc-stage__empty"><Icon name="image" size={26} /> No background set</div>}

            {layers.map(l => { const p = dispPos(l); return (
              <FigureLayer key={l.uid} id={l.id} label={l.name} active={active === l.uid} x={p.x} y={p.y}
                off={!onStage(l)} dragging={dragRef.current?.uid === l.uid} onDown={onLayerDown(l.uid)} />
            ) })}

            <div className="ppc-bgctl">
              <div className="ppc-bgctl__thumb">
                {background ? <PaperPlate id={background.id} kind="location" /> : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--faint)' }}><Icon name="image" size={14} /></div>}
              </div>
              <div className="ppc-bgctl__meta">
                <span className="ppc-bgctl__k">Setting · back layer</span>
                <span className="ppc-bgctl__name">{background ? background.name : 'None'}</span>
              </div>
              <button className="ppc-btn is-sm" disabled title="Background picker — Step 2b"><Icon name="refresh" size={13} /> Replace</button>
            </div>
            <span className="ppc-stage__fxnote"><Icon name="sparkles" size={11} /> FX layer · later</span>
          </div>

          <div className="ppc-zoomhud">
            <button className="ppc-zoomhud__b" title="Zoom out" onClick={() => setZoomC(zoom * 0.9)}><Glyph d={GLYPH.minus} size={15} /></button>
            <span className="ppc-zoomhud__v" title="Reset view" onClick={resetView}>{Math.round(zoom * 100)}%</span>
            <button className="ppc-zoomhud__b" title="Zoom in" onClick={() => setZoomC(zoom * 1.1)}><Icon name="plus" size={15} /></button>
          </div>
        </div>

        {/* EXTENDABLE TIMELINE */}
        <div className="ppc-tlpanel" style={{ height: tlH }}>
          <div className="ppc-tlresize" onPointerDown={tlDown} onPointerMove={tlMove} onPointerUp={tlUp} title="Drag to resize" />
          <div className="ppc-tl">
            <div className="ppc-tl__transport">
              <div className="ppc-tl__cluster">
                <button className="ppc-tl__tb" title="First frame" onClick={() => { setPlaying(false); setTime(0) }}><Glyph d={GLYPH.first} /></button>
                <button className="ppc-tl__tb" title="Previous keyframe" onClick={prevKey}><Glyph d={GLYPH.prevk} /></button>
                <button className="ppc-tl__tb" title="Previous frame" onClick={() => stepFrame(-1)}><Glyph d={GLYPH.prevf} /></button>
                <button className="ppc-tl__tb is-play" title={playing ? 'Pause' : 'Play'} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
                <button className="ppc-tl__tb" title="Next frame" onClick={() => stepFrame(1)}><Glyph d={GLYPH.nextf} /></button>
                <button className="ppc-tl__tb" title="Next keyframe" onClick={nextKey}><Glyph d={GLYPH.nextk} /></button>
                <button className="ppc-tl__tb" title="Last frame" onClick={() => { setPlaying(false); setTime(1) }}><Glyph d={GLYPH.last} /></button>
              </div>
              <button className={`ppc-tlloop${loop ? ' is-on' : ''}`} onClick={() => setLoop(l => !l)} title="Loop"><Icon name="refresh" size={13} /></button>
              <span className="ppc-tl__fps"><b>{FPS}</b> fps</span>
              <button className="ppc-btn is-sm" onClick={addKeyframe} disabled={!activeLayer}><Glyph d={GLYPH.diamond} size={13} /> Keyframe</button>
              <span className="ppc-tl__spacer" />
              <span className="ppc-tl__time">f<b style={{ color: 'var(--ink)' }}>{curFrame}</b><span className="dim">/{frames}</span> · {(time * durSec).toFixed(2)}<span className="dim">/{durSec.toFixed(2)}s</span></span>
            </div>

            {selPres && (() => {
              const l = layers.find(x => x.uid === selPres); if (!l) return null
              const inF = Math.round(l.inT * frames), outF = Math.round(l.outT * frames)
              return (
                <div className="ppc-clipinsp">
                  <span className="ppc-clipinsp__name"><span className="ppc-clipinsp__dot" style={{ background: scenePlate(l), borderRadius: '50%' }} />{l.name} · on stage</span>
                  <span className="ppc-clipinsp__f">Enter <input className="ppc-clipinsp__in" type="number" value={inF} onChange={e => updateLayer(l.uid, { inT: snapT(clamp((+e.target.value || 0) / frames, 0, l.outT - minLen)) })} /> f</span>
                  <span className="ppc-clipinsp__f">Exit <input className="ppc-clipinsp__in" type="number" value={outF} onChange={e => updateLayer(l.uid, { outT: snapT(clamp((+e.target.value || 0) / frames, l.inT + minLen, 1)) })} /> f</span>
                  <span className="ppc-clipinsp__spacer" />
                  <button className="ppc-clipinsp__btn" onClick={() => toggleVisible(l.uid)}><Icon name="eye" size={13} /> {l.visible ? 'Hide' : 'Show'} in scene</button>
                </div>
              )
            })()}

            <div className="ppc-tl__body">
              <div className="ppc-tl__heads">
                <div className="ppc-tl__heads-top">Layers</div>
                {tracks.map(tr => (
                  <div key={tr.key} className={`ppc-trackhead${dragOver === tr.key ? ' is-dropover' : ''}`} draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', tr.key)}
                    onDragOver={e => { e.preventDefault(); setDragOver(tr.key) }}
                    onDragLeave={() => setDragOver(d => (d === tr.key ? null : d))}
                    onDrop={e => { e.preventDefault(); const src = e.dataTransfer.getData('text/plain'); if (src) reorderTrack(src, tr.key); setDragOver(null) }}>
                    <div className={`ppc-trackhead__main${active === tr.key ? ' is-active' : ''}${tr.kind === 'background' ? ' is-bg' : ''}`}
                      onClick={() => tr.kind === 'character' && setActive(tr.key)}>
                      <span className="ppc-trackhead__grip"><Icon name="more-horizontal" size={12} /></span>
                      <span className="ppc-trackhead__ic" style={{ color: 'var(--muted)' }}><Icon name={tr.kind === 'background' ? 'image' : 'user'} size={12} /></span>
                      <span className="ppc-trackhead__name">{tr.name}</span>
                      {tr.kind === 'character'
                        ? <button className={`ppc-layerrow-h__eye${tr.layer!.visible ? '' : ' is-off'}`} title={tr.layer!.visible ? 'Hide layer' : 'Show layer'} onClick={e => { e.stopPropagation(); toggleVisible(tr.key) }}><Icon name="eye" size={12} /></button>
                        : <button className={`ppc-layerrow-h__eye${hiddenBg ? ' is-off' : ''}`} title={hiddenBg ? 'Show layer' : 'Hide layer'} onClick={e => { e.stopPropagation(); setHiddenBg(h => !h) }}><Icon name="eye" size={12} /></button>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="ppc-tl__lanes" ref={lanesRef} onPointerDown={lanesDown} onPointerMove={lanesMove} onPointerUp={lanesUp} onPointerLeave={lanesUp}>
                <div className="ppc-tl__ruler">
                  {ticks.map(f => (
                    <span key={f}><span className="ppc-tl__rtick" style={{ left: `${(f / frames) * 100}%` }} /><span className="ppc-tl__rnum" style={{ left: `${(f / frames) * 100}%` }}>{f}</span></span>
                  ))}
                </div>
                {tracks.map(tr => {
                  if (tr.kind === 'background') {
                    return <div key={tr.key} className={`ppc-lane${hiddenBg ? ' is-hidden' : ''}`} style={{ height: ROW }}><span className="ppc-track__lbl">{background ? 'setting' : 'no background'}</span></div>
                  }
                  const l = tr.layer!
                  const hue = hashId(l.id) % 360
                  const sel = selPres === l.uid
                  return (
                    <div key={tr.key} className={`ppc-lane${active === l.uid ? ' is-active' : ''}${l.visible ? '' : ' is-hidden'}`} style={{ height: ROW }} onClick={() => setActive(l.uid)}>
                      {l.inT > 0 && <span className="ppc-offzone" style={{ left: 0, width: `${l.inT * 100}%` }} />}
                      {l.outT < 1 && <span className="ppc-offzone" style={{ left: `${l.outT * 100}%`, right: 0 }} />}
                      <span className={`ppc-presence${sel ? ' is-sel' : ''}`} style={{ left: `${l.inT * 100}%`, width: `${(l.outT - l.inT) * 100}%`, borderColor: `hsl(${hue} 45% 50%)`, color: `hsl(${hue} 45% 38%)`, background: `hsl(${hue} 50% 92%)` }}
                        onPointerDown={presDown(l.uid, 'move')}>
                        <span className="ppc-presence__grip l" onPointerDown={presDown(l.uid, 'l')} />
                        <span className="ppc-presence__lbl">on stage</span>
                        <span className="ppc-presence__grip r" onPointerDown={presDown(l.uid, 'r')} />
                      </span>
                      {active === l.uid && (kf[l.uid] || []).map((k, i) => (
                        <span key={i} className={`ppc-kf2${Math.abs(k.t - time) < 0.02 ? ' is-near' : ''}`} style={{ left: `${k.t * 100}%` }}
                          onPointerDown={e => { e.stopPropagation(); setPlaying(false); setTime(k.t) }} title={`frame ${Math.round(k.t * frames)}`} />
                      ))}
                    </div>
                  )
                })}
                <span className="ppc-tl__head" style={{ left: `${time * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT WIDGET */}
      <div className="ppc-rdock">
        {panel && (
          <div className="ppc-rpanel">
            <div className="ppc-rpanel__head">
              <Icon name={(RAIL.find(r => r.id === panel)?.icon) || 'film'} size={15} />
              <b>{RAIL.find(r => r.id === panel)?.title}</b>
              <button className="ppc-iconbtn" title="Collapse" onClick={() => setPanel(null)}><Icon name="chevron-right" size={14} /></button>
            </div>
            <div className="ppc-rpanel__body">
              {panel === 'script' ? (
                <>
                  <div className="ppc-sblock">
                    <span className="ppc-sblock__k">Action</span>
                    <span className="ppc-sblock__scene">{scene.id} · {shot.id}</span>
                    <span className="ppc-sblock__action">{shot.action}</span>
                  </div>
                  <div className="ppc-sblock">
                    <span className="ppc-sblock__cue">{(charById(shot.characters[0] || '') || {} as Partial<LibEntry>).name || 'Dialogue'}</span>
                    <span className={`ppc-sblock__line${shot.dialogue ? '' : ' is-empty'}`}>{shot.dialogue || '— no line —'}</span>
                  </div>
                </>
              ) : (
                <div className="ppc-empty-note">The {RAIL.find(r => r.id === panel)?.title} generator lands in Step 2b.</div>
              )}
            </div>
          </div>
        )}
        <div className="ppc-rrail">
          {RAIL.map(r => (
            <button key={r.id} className={`ppc-tool2${panel === r.id ? ' is-on' : ''}`} title={r.title} onClick={() => setPanel(p => (p === r.id ? null : r.id))}>
              {r.glyph ? <Glyph d={GLYPH[r.glyph]} /> : <Icon name={r.icon!} size={16} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CanvasRigStudio() {
  const { id = '', sceneId, shotId } = useParams()
  const [scenes, setScenes] = useState<CanvasScene[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setScenes(null); setError('')
    studioApi.getCanvasScenes(id).then(s => { if (alive) setScenes(s) }).catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [id])

  if (error) return <div className={`ppc ppc-studio ${STUDIO_FIXED}`}><div className="ppc-studio__bar"><span className="ppc-board__title" style={{ color: 'var(--st-extracted)' }}>{error}</span></div></div>
  if (!scenes) return <div className={`ppc ppc-studio ${STUDIO_FIXED}`}><div className="ppc-studio__bar"><span className="ppc-board__title">Rig Studio</span></div></div>

  const scene = sceneById(scenes, sceneId)
  const shot = shotById(scene, shotId)
  return <StudioBody key={`${scene.id}/${shot.id}`} projectId={id} scenes={scenes} scene={scene} shot={shot} />
}
