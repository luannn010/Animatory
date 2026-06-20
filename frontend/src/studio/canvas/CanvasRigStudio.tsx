// Rig Studio — the Canvas track's animation editor (Steps 2a core + 2b authoring).
// Full-flush. Tool rail · Characters dock · canvas (pose/zoom/pan + object/effect
// sprites) · extendable multi-track keyframe timeline (presence bands, keyframes,
// + clip authoring: generate → clip → move/trim/split/delete on sub-lanes) ·
// right widget with the 5 generators (Script/Actions/Voices/FX/Objects).
// Picker modals + panel drag-drop are a later follow-up (Import buttons inert).
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../api'
import { Icon, type IconName } from '../ui/Icon'
import { Glyph, GLYPH } from './studioGlyphs'
import { StatusPill } from './StatusPill'
import { type CanvasScene, type CanvasShot, sceneById, shotById, charById, locById } from './canvasData'

const FPS = 24
const ROW = 26
const STUDIO_FIXED = 'fixed left-52 top-[60px] right-0 bottom-0 z-10'
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const hashId = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h }
const KIND_GLYPH: Record<string, IconName> = { character: 'user', location: 'map-pin', prop: 'package' }
const KIND_COLOR: Record<string, string> = { action: 'var(--accent)', voice: '#00897b', object: '#7a5cc0', effect: '#d47628', sfx: '#3d6cc7', baked: 'var(--accent)' }
const clipsOverlap = (a: Clip, t: number, len: number) => !(t + len <= a.t || t >= a.t + a.len)
const ACTION_NAMES = ['reach_for_slate', 'step_back', 'glance_left', 'draw_breath', 'pivot_run']
const EFFECT_NAMES = ['dust_motes', 'rain_streaks', 'lens_flare', 'smoke_curl', 'spark_burst']
const SFX_NAMES = ['footstep', 'door_creak', 'thunder', 'whoosh', 'chime']

type ClipKind = 'action' | 'voice' | 'object' | 'effect' | 'sfx' | 'baked'
interface Clip { id: string; kind: ClipKind; name: string; t: number; len: number; row: number; cx?: number; cy?: number }
interface Layer { uid: string; id: string; name: string; x: number; y: number; inT: number; outT: number; visible: boolean }
interface Key { t: number; x: number; y: number }
type Tool = 'cursor' | 'pose' | 'hand' | 'zoom' | 'comment'
type GenState = { state: 'idle' | 'loading' | 'success' | 'error'; pct?: number; last?: string; saved?: boolean; msg?: string }

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
  id: string; label: string; active: boolean; x: number; y: number; dragging: boolean; off: boolean; onDown: (e: React.PointerEvent) => void
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
  label: string; value: string; valueId: string; options: { id: string; label: string }[]; onPick: (id: string) => void
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
        <span>{value}</span><span className="ppc-id">{valueId}</span>
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

// generate hero with idle/loading/error/success states
function GenButton({ label, gen, onGen, onRetry, disabled }: { label: string; gen: GenState; onGen: () => void; onRetry: () => void; disabled?: boolean }) {
  return (
    <div className={`ppc-gen${gen.state === 'error' ? ' is-error' : ''}`}>
      <button className={`ppc-btn is-primary ppc-gen__btn${gen.state === 'loading' ? ' is-loading' : ''}`} disabled={disabled || gen.state === 'loading'} onClick={onGen}>
        <Icon name="sparkles" size={15} /> {label}
        {gen.state === 'loading' && <span className="ppc-gen__spin" />}
      </button>
      {gen.state === 'loading' && gen.pct != null && <div className="ppc-gen__bar"><div className="ppc-gen__bar-fill" style={{ width: `${gen.pct}%` }} /></div>}
      {gen.state === 'error' && <div className="ppc-gen__err"><Icon name="x" size={13} /> {gen.msg || 'Generation failed.'} <button onClick={onRetry}>Retry</button></div>}
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
  const [panel, setPanel] = useState<string | null>('actions')
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // clips + selection (presence band = '__pres')
  const [clips, setClips] = useState<Record<string, Clip[]>>({})
  const [sel, setSel] = useState<{ uid: string; id: string } | null>(null)
  // generators
  const [charActions, setCharActions] = useState<Record<string, string[]>>({})
  const [globalActions, setGlobalActions] = useState<string[]>(['idle_breathe', 'turn_to_camera'])
  const [actionsTab, setActionsTab] = useState<'this' | 'global'>('this')
  const [saveScope, setSaveScope] = useState<'char' | 'global'>('char')
  const [gen, setGen] = useState<GenState>({ state: 'idle', pct: 0 })
  const [voiceGen, setVoiceGen] = useState<GenState>({ state: 'idle' })
  const [objGen, setObjGen] = useState<GenState>({ state: 'idle' })
  const [fxGen, setFxGen] = useState<GenState>({ state: 'idle' })
  const [sfxGen, setSfxGen] = useState<GenState>({ state: 'idle' })
  const [voices, setVoices] = useState<{ name: string; len: number }[]>([])
  const [createdObjects, setCreatedObjects] = useState<{ id: string; name: string; len: number }[]>([])
  const [effects, setEffects] = useState<{ name: string; len: number }[]>([])
  const [sfxList, setSfxList] = useState<{ name: string; len: number }[]>([])

  const rafRef = useRef(0)
  const dragRef = useRef<{ uid: string } | null>(null)
  const objDragRef = useRef<{ key: string; id: string } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const tlDragRef = useRef<{ sy: number; h: number } | null>(null)
  const presDragRef = useRef<{ uid: string; mode: 'move' | 'l' | 'r'; startX: number; inT: number; outT: number } | null>(null)
  const clipDragRef = useRef<{ uid: string; id: string; mode: 'move' | 'l' | 'r'; startX: number; startT: number; startLen: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const clipIdRef = useRef(0)
  const timers = useRef<number[]>([])

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); timers.current.forEach(clearTimeout) }, [])

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

  // keyboard: Delete removes the selected clip
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.id !== '__pres' && !/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault(); deleteClip(sel.uid, sel.id)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, clips])

  const activeLayer = layers.find(l => l.uid === active) ?? null
  const activeChar = activeLayer
  const live = playing || scrubbing
  const curFrame = Math.round(time * frames)
  const sceneNo = `Scene ${scene.id.split('-')[1] ?? ''}`
  const shotNo = `Shot ${shot.id.slice(-3)}`
  const cueName = activeChar ? activeChar.name : (charById(shot.characters[0] || '')?.name ?? null)
  const onStage = (l: Layer) => l.visible !== false && time >= l.inT - 1e-6 && time <= l.outT + 1e-6
  const dispPos = (l: Layer) => {
    const keys = kf[l.uid]
    if (live && keys && keys.length) { const p = interpKeys(keys, time); if (p) return p }
    return { x: l.x, y: l.y }
  }
  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(fn, ms); timers.current.push(id); return id }

  // ── pose / zoom / pan ──
  const onLayerDown = (uid: string) => (e: React.PointerEvent) => {
    e.stopPropagation(); setActive(uid)
    if (live || tool !== 'pose') return
    dragRef.current = { uid }
    try { canvasRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }
  const onCanvasMove = (e: React.PointerEvent) => {
    const od = objDragRef.current
    if (od && canvasRef.current) {
      const r = canvasRef.current.getBoundingClientRect()
      updateClip(od.key, od.id, { cx: clamp(((e.clientX - r.left) / r.width) * 100, 2, 98), cy: clamp(((e.clientY - r.top) / r.height) * 100, 4, 96) })
      return
    }
    const d = dragRef.current; if (!d || !canvasRef.current) return
    const r = canvasRef.current.getBoundingClientRect()
    setLayers(ls => ls.map(l => (l.uid === d.uid ? { ...l, x: clamp(((e.clientX - r.left) / r.width) * 100, 6, 94), y: clamp(((e.clientY - r.top) / r.height) * 100 - 20, 2, 74) } : l)))
  }
  const onCanvasUp = () => { dragRef.current = null; objDragRef.current = null }
  const onObjDown = (key: string, id: string) => (e: React.PointerEvent) => {
    e.stopPropagation(); setSel({ uid: key, id }); objDragRef.current = { key, id }
    try { canvasRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }
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

  // ── clips ──
  const rowsNeeded = (key: string) => (clips[key] || []).reduce((m, c) => Math.max(m, c.row + 1), 0)
  const addClipToLane = (key: string | null, info: { name: string; kind?: ClipKind; len?: number; cx?: number; cy?: number }, t?: number) => {
    if (!key) return
    const len = clamp(info.len ?? 0.25, minLen, 1)
    const startT = clamp(t == null ? time : t, 0, 1 - len)
    const id = `c${++clipIdRef.current}`
    setClips(m => {
      const arr = m[key] || []
      let r = 0; while (arr.some(c => c.row === r && clipsOverlap(c, startT, len))) r++
      const onCanvas = info.kind === 'object' || info.kind === 'effect'
      const extra = onCanvas ? { cx: info.cx ?? 50, cy: info.cy ?? 56 } : {}
      return { ...m, [key]: [...arr, { id, kind: info.kind || 'action', name: info.name, t: snapT(startT), len: snapT(len), row: r, ...extra }] }
    })
    setExpanded(x => ({ ...x, [key]: true }))
    setSel({ uid: key, id })
  }
  const addActionToTimeline = (name: string, kind: ClipKind = 'action') => addClipToLane(active, { name, kind, len: kind === 'voice' ? 0.3 : 0.25 })
  const updateClip = (uid: string, id: string, patch: Partial<Clip>) => setClips(m => ({ ...m, [uid]: (m[uid] || []).map(c => (c.id === id ? { ...c, ...patch } : c)) }))
  const deleteClip = (uid: string, id: string) => { setClips(m => ({ ...m, [uid]: (m[uid] || []).filter(c => c.id !== id) })); setSel(null) }
  const splitClip = () => {
    if (!sel || sel.id === '__pres') return
    const arr = clips[sel.uid] || []; const c = arr.find(x => x.id === sel.id); if (!c) return
    if (time <= c.t + minLen || time >= c.t + c.len - minLen) return
    const leftLen = snapT(time - c.t)
    const right: Clip = { id: `c${++clipIdRef.current}`, kind: c.kind, name: c.name, t: snapT(time), len: snapT(c.len - leftLen), row: c.row }
    setClips(m => ({ ...m, [sel.uid]: [...arr.map(x => (x.id === c.id ? { ...x, len: leftLen } : x)), right] }))
  }
  const clipDown = (uid: string, clip: Clip, mode: 'move' | 'l' | 'r') => (e: React.PointerEvent) => {
    e.stopPropagation(); setSel({ uid, id: clip.id }); setPlaying(false)
    clipDragRef.current = { uid, id: clip.id, mode, startX: e.clientX, startT: clip.t, startLen: clip.len }
    try { lanesRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }

  // ── presence band ──
  const updateLayer = (uid: string, patch: Partial<Layer>) => setLayers(ls => ls.map(l => (l.uid === uid ? { ...l, ...patch } : l)))
  const toggleVisible = (uid: string) => setLayers(ls => ls.map(l => (l.uid === uid ? { ...l, visible: !l.visible } : l)))
  const presDown = (uid: string, mode: 'move' | 'l' | 'r') => (e: React.PointerEvent) => {
    e.stopPropagation()
    const l = layers.find(x => x.uid === uid); if (!l) return
    setActive(uid); setSel({ uid, id: '__pres' }); setPlaying(false)
    presDragRef.current = { uid, mode, startX: e.clientX, inT: l.inT, outT: l.outT }
    try { lanesRef.current?.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
  }

  // ── transport / scrub / timeline drag ──
  const togglePlay = () => { if (time >= 1) setTime(0); setPlaying(p => !p) }
  const seekFromEl = (el: HTMLElement, clientX: number) => { const r = el.getBoundingClientRect(); setTime(clamp((clientX - r.left) / r.width, 0, 1)) }
  const stepFrame = (d: number) => { setPlaying(false); setTime(t => clamp(t + d / frames, 0, 1)) }
  const lanesDown = (e: React.PointerEvent) => { setSel(null); setPlaying(false); setScrubbing(true); seekFromEl(lanesRef.current!, e.clientX); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  const lanesMove = (e: React.PointerEvent) => {
    const pd = presDragRef.current
    if (pd && lanesRef.current) {
      const r = lanesRef.current.getBoundingClientRect(); const df = (e.clientX - pd.startX) / r.width
      let inT = pd.inT, outT = pd.outT
      if (pd.mode === 'move') { const w = pd.outT - pd.inT; inT = clamp(pd.inT + df, 0, 1 - w); outT = inT + w }
      else if (pd.mode === 'l') inT = clamp(pd.inT + df, 0, pd.outT - minLen)
      else if (pd.mode === 'r') outT = clamp(pd.outT + df, pd.inT + minLen, 1)
      updateLayer(pd.uid, { inT: snapT(inT), outT: snapT(outT) })
      return
    }
    const cd = clipDragRef.current
    if (cd && lanesRef.current) {
      const r = lanesRef.current.getBoundingClientRect(); const df = (e.clientX - cd.startX) / r.width
      let t = cd.startT, len = cd.startLen
      if (cd.mode === 'move') t = clamp(cd.startT + df, 0, 1 - cd.startLen)
      else if (cd.mode === 'r') len = clamp(cd.startLen + df, minLen, 1 - cd.startT)
      else if (cd.mode === 'l') { const nt = clamp(cd.startT + df, 0, cd.startT + cd.startLen - minLen); len = cd.startLen - (nt - cd.startT); t = nt }
      updateClip(cd.uid, cd.id, { t: snapT(t), len: snapT(len) })
      return
    }
    if (scrubbing) seekFromEl(lanesRef.current!, e.clientX)
  }
  const lanesUp = () => { presDragRef.current = null; clipDragRef.current = null; setScrubbing(false) }
  const tlDown = (e: React.PointerEvent) => { tlDragRef.current = { sy: e.clientY, h: tlH }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  const tlMove = (e: React.PointerEvent) => { const d = tlDragRef.current; if (!d) return; setTlH(clamp(d.h + (d.sy - e.clientY), 150, 440)) }
  const tlUp = () => { tlDragRef.current = null }

  // ── tracks (characters + background), reorderable + collapsible ──
  type Track = { key: string; kind: 'character' | 'background'; name: string; layer?: Layer }
  const base: Track[] = [
    ...layers.map(l => ({ key: l.uid, kind: 'character' as const, name: l.name, layer: l })),
    { key: 'bg', kind: 'background' as const, name: background ? background.name : 'Background' },
  ]
  const [dragOver, setDragOver] = useState<string | null>(null)
  const tracks: Track[] = (() => {
    const byKey = Object.fromEntries(base.map(t => [t.key, t]))
    const seen = new Set<string>(); const out: Track[] = []
    order.forEach(k => { if (byKey[k] && !seen.has(k)) { out.push(byKey[k]); seen.add(k) } })
    base.forEach(t => { if (!seen.has(t.key)) out.push(t) })
    return out
  })()
  const subRowsOf = (key: string) => (expanded[key] === false ? 0 : rowsNeeded(key))
  const reorderTrack = (src: string, dst: string) => {
    if (src === dst) return
    const keys = tracks.map(t => t.key).filter(k => k !== src)
    const di = keys.indexOf(dst); keys.splice(di < 0 ? keys.length : di, 0, src); setOrder(keys)
  }
  const subKindAt = (key: string, row: number): ClipKind => (clips[key] || []).find(c => c.row === row)?.kind || 'action'

  const ruleStep = frames > 60 ? 12 : 6
  const ticks: number[] = []; for (let f = 0; f <= frames; f += ruleStep) ticks.push(f)
  const goStudio = (sid: string, shid: string) => navigate(`/project/${projectId}/pre/canvas/${sid}/${shid}/studio`)

  // ── generators (mock async) ──
  const generateAction = () => {
    if (gen.state === 'loading') return
    if (!background) { setGen({ state: 'error', msg: 'Import a background before generating.' }); return }
    if (!activeChar) { setGen({ state: 'error', msg: 'Select a character layer first.' }); return }
    setGen({ state: 'loading', pct: 0 })
    const tick = () => setGen(g => {
      if (g.state !== 'loading') return g
      const pct = (g.pct ?? 0) + 12 + Math.random() * 8
      if (pct >= 100) { const name = ACTION_NAMES[Math.floor(Math.random() * ACTION_NAMES.length)]; setCharActions(m => ({ ...m, [activeChar.id]: [...(m[activeChar.id] || []), name] })); return { state: 'success', pct: 100, last: name, saved: false } }
      later(tick, 120); return { ...g, pct }
    })
    later(tick, 120)
  }
  const saveAction = () => { const last = gen.last; if (!last) return; if (saveScope === 'global') setGlobalActions(g => (g.includes(last) ? g : [...g, last])); setGen(g => ({ ...g, saved: true })) }
  const wordCount = (shot.dialogue || '').trim().split(/\s+/).filter(Boolean).length
  const generateVoice = () => {
    if (voiceGen.state === 'loading' || !shot.dialogue) return
    setVoiceGen({ state: 'loading' })
    later(() => { const len = clamp(Math.max(0.8, wordCount * 0.34) / durSec, 0.08, 1); const name = `${(cueName || 'VO').toLowerCase()}_vo${voices.length + 1}`; setVoices(v => [...v, { name, len }]); setVoiceGen({ state: 'success', last: name }) }, 1400)
  }
  const generateObject = () => {
    if (objGen.state === 'loading') return
    setObjGen({ state: 'loading' })
    later(() => { const id = `obj_${shot.id.slice(-3).toLowerCase()}_${createdObjects.length + 1}`; setCreatedObjects(o => [...o, { id, name: id, len: 0.3 }]); setObjGen({ state: 'success', last: id }) }, 1500)
  }
  const generateEffect = () => {
    if (fxGen.state === 'loading') return
    setFxGen({ state: 'loading' })
    later(() => { const name = `${EFFECT_NAMES[Math.floor(Math.random() * EFFECT_NAMES.length)]}_${effects.length + 1}`; setEffects(v => [...v, { name, len: 0.35 }]); setFxGen({ state: 'success', last: name }) }, 1400)
  }
  const generateSfx = () => {
    if (sfxGen.state === 'loading') return
    setSfxGen({ state: 'loading' })
    later(() => { const name = `${SFX_NAMES[Math.floor(Math.random() * SFX_NAMES.length)]}_sfx${sfxList.length + 1}`; setSfxList(v => [...v, { name, len: 0.18 }]); setSfxGen({ state: 'success', last: name }) }, 1300)
  }
  const thisActions = activeChar ? (charActions[activeChar.id] || []) : []

  // object/effect clips become sprites on the canvas during their window
  const canvasItems: { key: string; c: Clip }[] = []
  Object.keys(clips).forEach(key => (clips[key] || []).forEach(c => {
    if (!((c.kind === 'object' || c.kind === 'effect') && time >= c.t - 1e-6 && time <= c.t + c.len + 1e-6)) return
    if (key === 'bg' ? hiddenBg : layers.find(l => l.uid === key)?.visible === false) return
    canvasItems.push({ key, c })
  }))

  const ActionChip = ({ name }: { name: string }) => (
    <div className="ppc-act">
      <span className="ppc-act__dot" /><span className="ppc-act__name">{name}</span>
      <button className="ppc-act__add" disabled={!active} onClick={() => addActionToTimeline(name, 'action')}><Icon name="plus" size={11} /> Lane</button>
    </div>
  )
  const GenList = ({ items, kind }: { items: { name: string; len: number }[]; kind: ClipKind }) => (
    <>{items.map((it, i) => (
      <div key={i} className="ppc-act">
        <span className="ppc-act__dot" style={{ background: KIND_COLOR[kind] }} /><span className="ppc-act__name">{it.name}</span>
        <button className="ppc-act__add" disabled={!active && kind !== 'object'} onClick={() => addClipToLane(kind === 'object' ? (active || 'bg') : active, { name: it.name, kind, len: it.len })}><Icon name="plus" size={11} /> Lane</button>
      </div>
    ))}</>
  )

  return (
    <div className={`ppc ppc-studio ${STUDIO_FIXED}${playing ? ' is-playing' : ''}`}>
      {/* BAR */}
      <div className="ppc-studio__bar">
        <Dropdown label="Scene" value={sceneNo} valueId={scene.id} options={scenes.map(s => ({ id: s.id, label: `Scene ${s.id.split('-')[1]}` }))}
          onPick={sid => { const s = sceneById(scenes, sid); goStudio(sid, s.shots[0].id) }} />
        <span style={{ display: 'inline-flex', color: 'var(--faint)' }}><Icon name="chevron-right" size={15} /></span>
        <Dropdown label="Shot" value={shotNo} valueId={shot.id} options={scene.shots.map(sh => ({ id: sh.id, label: `Shot ${sh.id.slice(-3)}` }))} onPick={shid => goStudio(scene.id, shid)} />
        <div className="ppc-crumb" style={{ marginLeft: 14 }}>
          <span>Project</span><span className="ppc-crumb__sep">/</span><b>{sceneNo}</b><span className="ppc-crumb__sep">/</span><b>{shotNo}</b>
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
          <button className="ppc-btn is-sm" disabled title="Import picker — follow-up"><Icon name="plus" size={14} /> Import Character</button>
          {layers.map(l => (
            <div key={l.uid} className={`ppc-layer${active === l.uid ? ' is-active' : ''}`} onClick={() => setActive(l.uid)}>
              <div className="ppc-layer__thumb"><PaperPlate id={l.id} kind="character" /></div>
              <div style={{ minWidth: 0 }}><div className="ppc-layer__name">{l.name}</div><div className="ppc-layer__kind">layer</div></div>
              <button className={`ppc-layer__eye${l.visible ? '' : ' is-off'}`} title={l.visible ? 'Hide layer' : 'Show layer'} onClick={e => { e.stopPropagation(); toggleVisible(l.uid) }}><Icon name="eye" size={14} /></button>
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
            {background && !hiddenBg ? <div className="ppc-stage__bg"><PaperPlate id={background.id} kind="location" /></div>
              : !background && <div className="ppc-stage__empty"><Icon name="image" size={26} /> No background set</div>}
            {layers.map(l => { const p = dispPos(l); return (
              <FigureLayer key={l.uid} id={l.id} label={l.name} active={active === l.uid} x={p.x} y={p.y} off={!onStage(l)} dragging={dragRef.current?.uid === l.uid} onDown={onLayerDown(l.uid)} />
            ) })}
            {canvasItems.map(({ key, c }) => {
              const isSel = sel?.uid === key && sel?.id === c.id
              return (
                <div key={key + c.id} className={`ppc-canvasobj${isSel ? ' is-sel' : ''}`} style={{ left: `${c.cx ?? 50}%`, top: `${c.cy ?? 56}%` }} onPointerDown={onObjDown(key, c.id)}>
                  {c.kind === 'effect' ? <span className="ppc-canvasobj__fx"><Glyph d={GLYPH.fx} size={20} /></span> : <span className="ppc-canvasobj__plate"><PaperPlate id={c.name} kind="prop" /></span>}
                  <span className="ppc-canvasobj__lbl">{c.name}</span>
                </div>
              )
            })}
            <div className="ppc-bgctl">
              <div className="ppc-bgctl__thumb">{background ? <PaperPlate id={background.id} kind="location" /> : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--faint)' }}><Icon name="image" size={14} /></div>}</div>
              <div className="ppc-bgctl__meta"><span className="ppc-bgctl__k">Setting · back layer</span><span className="ppc-bgctl__name">{background ? background.name : 'None'}</span></div>
              <button className="ppc-btn is-sm" disabled title="Background picker — follow-up"><Icon name="refresh" size={13} /> Replace</button>
            </div>
            <span className="ppc-stage__fxnote"><Icon name="sparkles" size={11} /> FX layer · later</span>
          </div>
          <div className="ppc-zoomhud">
            <button className="ppc-zoomhud__b" title="Zoom out" onClick={() => setZoomC(zoom * 0.9)}><Glyph d={GLYPH.minus} size={15} /></button>
            <span className="ppc-zoomhud__v" title="Reset view" onClick={resetView}>{Math.round(zoom * 100)}%</span>
            <button className="ppc-zoomhud__b" title="Zoom in" onClick={() => setZoomC(zoom * 1.1)}><Icon name="plus" size={15} /></button>
          </div>
        </div>

        {/* TIMELINE */}
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

            {sel && (() => {
              if (sel.id === '__pres') {
                const l = layers.find(x => x.uid === sel.uid); if (!l) return null
                return (
                  <div className="ppc-clipinsp">
                    <span className="ppc-clipinsp__name"><span className="ppc-clipinsp__dot" style={{ background: `hsl(${hashId(l.id) % 360} 35% 55%)`, borderRadius: '50%' }} />{l.name} · on stage</span>
                    <span className="ppc-clipinsp__f">Enter <input className="ppc-clipinsp__in" type="number" value={Math.round(l.inT * frames)} onChange={e => updateLayer(l.uid, { inT: snapT(clamp((+e.target.value || 0) / frames, 0, l.outT - minLen)) })} /> f</span>
                    <span className="ppc-clipinsp__f">Exit <input className="ppc-clipinsp__in" type="number" value={Math.round(l.outT * frames)} onChange={e => updateLayer(l.uid, { outT: snapT(clamp((+e.target.value || 0) / frames, l.inT + minLen, 1)) })} /> f</span>
                    <span className="ppc-clipinsp__spacer" />
                    <button className="ppc-clipinsp__btn" onClick={() => toggleVisible(l.uid)}><Icon name="eye" size={13} /> {l.visible ? 'Hide' : 'Show'} in scene</button>
                  </div>
                )
              }
              const c = (clips[sel.uid] || []).find(x => x.id === sel.id); if (!c) return null
              const layerName = layers.find(l => l.uid === sel.uid)?.name || (sel.uid === 'bg' ? 'Background' : '')
              return (
                <div className="ppc-clipinsp">
                  <span className="ppc-clipinsp__name"><span className="ppc-clipinsp__dot" style={{ background: KIND_COLOR[c.kind] }} />{c.name}</span>
                  <span className="ppc-clipinsp__f">on {layerName}</span>
                  <span className="ppc-clipinsp__f">Start <input className="ppc-clipinsp__in" type="number" value={Math.round(c.t * frames)} onChange={e => updateClip(sel.uid, c.id, { t: snapT(clamp((+e.target.value || 0) / frames, 0, 1 - c.len)) })} /> f</span>
                  <span className="ppc-clipinsp__f">Len <input className="ppc-clipinsp__in" type="number" value={Math.max(1, Math.round(c.len * frames))} onChange={e => updateClip(sel.uid, c.id, { len: snapT(clamp((+e.target.value || 1) / frames, minLen, 1 - c.t)) })} /> f</span>
                  <span className="ppc-clipinsp__spacer" />
                  <button className="ppc-clipinsp__btn" onClick={splitClip} title="Cut at playhead"><Glyph d={GLYPH.script} size={12} /> Cut</button>
                  <button className="ppc-clipinsp__btn is-del" onClick={() => deleteClip(sel.uid, c.id)}><Icon name="x" size={13} /> Delete</button>
                </div>
              )
            })()}

            <div className="ppc-tl__body">
              <div className="ppc-tl__heads">
                <div className="ppc-tl__heads-top">Layers</div>
                {tracks.map(tr => {
                  const subRows = subRowsOf(tr.key)
                  const open = expanded[tr.key] !== false
                  return (
                    <div key={tr.key} className={`ppc-trackhead${dragOver === tr.key ? ' is-dropover' : ''}`} draggable
                      onDragStart={e => e.dataTransfer.setData('text/plain', tr.key)}
                      onDragOver={e => { e.preventDefault(); setDragOver(tr.key) }}
                      onDragLeave={() => setDragOver(d => (d === tr.key ? null : d))}
                      onDrop={e => { e.preventDefault(); const src = e.dataTransfer.getData('text/plain'); if (src) reorderTrack(src, tr.key); setDragOver(null) }}>
                      <div className={`ppc-trackhead__main${active === tr.key ? ' is-active' : ''}${tr.kind === 'background' ? ' is-bg' : ''}`} onClick={() => tr.kind === 'character' && setActive(tr.key)}>
                        <span className="ppc-trackhead__grip"><Icon name="more-horizontal" size={12} /></span>
                        <span className={`ppc-trackhead__chev ${open ? 'is-open' : 'is-closed'}`} onClick={e => { e.stopPropagation(); setExpanded(x => ({ ...x, [tr.key]: x[tr.key] === false })) }}><Icon name="chevron-down" size={12} /></span>
                        <span className="ppc-trackhead__ic" style={{ color: 'var(--muted)' }}><Icon name={tr.kind === 'background' ? 'image' : 'user'} size={12} /></span>
                        <span className="ppc-trackhead__name">{tr.name}</span>
                        {tr.kind === 'character'
                          ? <button className={`ppc-layerrow-h__eye${tr.layer!.visible ? '' : ' is-off'}`} title={tr.layer!.visible ? 'Hide layer' : 'Show layer'} onClick={e => { e.stopPropagation(); toggleVisible(tr.key) }}><Icon name="eye" size={12} /></button>
                          : <button className={`ppc-layerrow-h__eye${hiddenBg ? ' is-off' : ''}`} title={hiddenBg ? 'Show layer' : 'Hide layer'} onClick={e => { e.stopPropagation(); setHiddenBg(h => !h) }}><Icon name="eye" size={12} /></button>}
                      </div>
                      {Array.from({ length: subRows }).map((_, r) => (
                        <div key={r} className="ppc-trackhead__sub"><span className="ppc-trackhead__subdot" style={{ background: KIND_COLOR[subKindAt(tr.key, r)] }} />{subKindAt(tr.key, r)}</div>
                      ))}
                    </div>
                  )
                })}
              </div>

              <div className="ppc-tl__lanes" ref={lanesRef} onPointerDown={lanesDown} onPointerMove={lanesMove} onPointerUp={lanesUp} onPointerLeave={lanesUp}>
                <div className="ppc-tl__ruler">
                  {ticks.map(f => (<span key={f}><span className="ppc-tl__rtick" style={{ left: `${(f / frames) * 100}%` }} /><span className="ppc-tl__rnum" style={{ left: `${(f / frames) * 100}%` }}>{f}</span></span>))}
                </div>
                {tracks.map(tr => {
                  const subRows = subRowsOf(tr.key)
                  const mainLane = tr.kind === 'background'
                    ? <div className={`ppc-lane${hiddenBg ? ' is-hidden' : ''}`} style={{ height: ROW }}><span className="ppc-track__lbl">{background ? 'setting' : 'no background'}</span></div>
                    : (() => {
                      const l = tr.layer!; const hue = hashId(l.id) % 360; const isSel = sel?.uid === l.uid && sel?.id === '__pres'
                      return (
                        <div className={`ppc-lane${active === l.uid ? ' is-active' : ''}${l.visible ? '' : ' is-hidden'}`} style={{ height: ROW }} onClick={() => setActive(l.uid)}>
                          {l.inT > 0 && <span className="ppc-offzone" style={{ left: 0, width: `${l.inT * 100}%` }} />}
                          {l.outT < 1 && <span className="ppc-offzone" style={{ left: `${l.outT * 100}%`, right: 0 }} />}
                          <span className={`ppc-presence${isSel ? ' is-sel' : ''}`} style={{ left: `${l.inT * 100}%`, width: `${(l.outT - l.inT) * 100}%`, borderColor: `hsl(${hue} 45% 50%)`, color: `hsl(${hue} 45% 38%)`, background: `hsl(${hue} 50% 92%)` }} onPointerDown={presDown(l.uid, 'move')}>
                            <span className="ppc-presence__grip l" onPointerDown={presDown(l.uid, 'l')} /><span className="ppc-presence__lbl">on stage</span><span className="ppc-presence__grip r" onPointerDown={presDown(l.uid, 'r')} />
                          </span>
                          {active === l.uid && (kf[l.uid] || []).map((k, i) => (
                            <span key={i} className={`ppc-kf2${Math.abs(k.t - time) < 0.02 ? ' is-near' : ''}`} style={{ left: `${k.t * 100}%` }} onPointerDown={e => { e.stopPropagation(); setPlaying(false); setTime(k.t) }} title={`frame ${Math.round(k.t * frames)}`} />
                          ))}
                        </div>
                      )
                    })()
                  return (
                    <div key={tr.key}>
                      {mainLane}
                      {Array.from({ length: subRows }).map((_, r) => (
                        <div key={r} className="ppc-lane" style={{ height: ROW }}>
                          <span className={`ppc-substripe k-${subKindAt(tr.key, r)}`} style={{ top: 0, bottom: 0 }} />
                          {(clips[tr.key] || []).filter(c => c.row === r).map(c => {
                            const isSel = sel?.uid === tr.key && sel?.id === c.id
                            return (
                              <span key={c.id} className={`ppc-clip kind-${c.kind}${isSel ? ' is-sel' : ''}${clipDragRef.current?.id === c.id ? ' is-moving' : ''}`}
                                style={{ left: `${c.t * 100}%`, width: `${c.len * 100}%` }} onPointerDown={clipDown(tr.key, c, 'move')} title={c.name}>
                                <span className="ppc-clip__grip l" onPointerDown={clipDown(tr.key, c, 'l')} />
                                <span className="ppc-clip__label">{c.name}</span>
                                <span className="ppc-clip__grip r" onPointerDown={clipDown(tr.key, c, 'r')} />
                              </span>
                            )
                          })}
                        </div>
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
              {(() => { const r = RAIL.find(x => x.id === panel)!; return r.glyph ? <Glyph d={GLYPH[r.glyph]} /> : <Icon name={r.icon!} size={15} /> })()}
              <b>{RAIL.find(r => r.id === panel)?.title}</b>
              <button className="ppc-iconbtn" title="Collapse" onClick={() => setPanel(null)}><Icon name="chevron-right" size={14} /></button>
            </div>
            <div className="ppc-rpanel__body">
              {panel === 'script' && (<>
                <div className="ppc-sblock"><span className="ppc-sblock__k">Action</span><span className="ppc-sblock__scene">{scene.id} · {shot.id}</span><span className="ppc-sblock__action">{shot.action}</span></div>
                <div className="ppc-sblock"><span className="ppc-sblock__cue">{cueName || 'Dialogue'}</span><span className={`ppc-sblock__line${shot.dialogue ? '' : ' is-empty'}`}>{shot.dialogue || '— no line —'}</span></div>
              </>)}

              {panel === 'actions' && (<>
                <GenButton label={gen.state === 'success' ? 'Generate another' : 'Generate Action'} gen={gen} onGen={generateAction} onRetry={() => setGen({ state: 'idle', pct: 0 })} disabled={!activeChar} />
                {gen.state === 'success' && gen.last && (
                  <div className="ppc-gen__ok"><Icon name="check" size={13} /> {gen.last} · added to {activeChar?.name}</div>
                )}
                {gen.state === 'success' && gen.last && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="ppc-scope">
                      <button className={`ppc-scope__b${saveScope === 'char' ? ' is-on' : ''}`} onClick={() => setSaveScope('char')}>This character</button>
                      <button className={`ppc-scope__b${saveScope === 'global' ? ' is-on' : ''}`} onClick={() => setSaveScope('global')}>Global library</button>
                    </div>
                    <button className="ppc-btn is-sm" disabled={gen.saved} onClick={saveAction}><Icon name="check" size={13} /> {gen.saved ? 'Saved' : 'Save action'}</button>
                  </div>
                )}
                <div className="ppc-tabs">
                  <button className={`ppc-tabs__b${actionsTab === 'this' ? ' is-on' : ''}`} onClick={() => setActionsTab('this')}>This character</button>
                  <button className={`ppc-tabs__b${actionsTab === 'global' ? ' is-on' : ''}`} onClick={() => setActionsTab('global')}>Global</button>
                </div>
                {(actionsTab === 'this' ? thisActions : globalActions).map((n, i) => <ActionChip key={i} name={n} />)}
                {(actionsTab === 'this' ? thisActions : globalActions).length === 0 && <div className="ppc-empty-note">No actions yet. Generate one, then add it to the active character's lane.</div>}
              </>)}

              {panel === 'voices' && (<>
                <GenButton label="Generate Voice" gen={voiceGen} onGen={generateVoice} onRetry={() => setVoiceGen({ state: 'idle' })} disabled={!shot.dialogue} />
                {!shot.dialogue && <div className="ppc-empty-note">This shot has no dialogue line to voice.</div>}
                <GenList items={voices} kind="voice" />
              </>)}

              {panel === 'fx' && (<>
                <div className="ppc-fxgroup"><Glyph d={GLYPH.fx} size={13} /> Visual effects</div>
                <GenButton label="Generate Effect" gen={fxGen} onGen={generateEffect} onRetry={() => setFxGen({ state: 'idle' })} />
                <GenList items={effects} kind="effect" />
                <div className="ppc-fxgroup"><Icon name="volume-2" size={13} /> Sound FX</div>
                <GenButton label="Generate Sound FX" gen={sfxGen} onGen={generateSfx} onRetry={() => setSfxGen({ state: 'idle' })} />
                <GenList items={sfxList} kind="sfx" />
              </>)}

              {panel === 'objects' && (<>
                <GenButton label="Generate Object" gen={objGen} onGen={generateObject} onRetry={() => setObjGen({ state: 'idle' })} />
                <GenList items={createdObjects.map(o => ({ name: o.name, len: o.len }))} kind="object" />
                {createdObjects.length === 0 && <div className="ppc-empty-note">Generate a prop; it lands on the active layer and shows on the canvas during its clip.</div>}
              </>)}
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
