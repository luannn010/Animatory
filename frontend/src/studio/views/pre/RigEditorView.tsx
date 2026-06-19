// Rig editor — a full-bleed, dark, tool-like surface (the Animatory Design
// System's rig studio) wired to the real FK + reducer engine. Accent #3772cf =
// selection / active mode; teal #00d4a4 is reserved for live playback, the
// playhead and pose deltas. PreShell renders this route flush (no max-width /
// page chrome); the root breaks out of the shell padding and owns the viewport.
import { useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { Bone, RigDoc, RigMode } from '../../types'
import { rigReducer, initRigState, emptyRig, toRigDoc, previewPose } from '../../rig/rigReducer'
import { RigStage, type DrawnBone } from '../../rig/RigStage'
import { buildHumanoid } from '../../rig/humanoid'
import { loadDesignAssets } from '../../entityAssets'
import { Icon, type IconName } from '../../ui/Icon'

const DEG = 180 / Math.PI
const toDeg = (r: number) => Math.round(r * DEG)
const toRad = (d: number) => d / DEG
const POSED_EPS = 0.0087 // ~0.5° — a bone counts as "posed" past this delta
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0f1419]'
const isDrawn = (id: string) => /^b\d+$/.test(id) // hand-drawn bones; the humanoid template is protected

const MODES: { id: RigMode; label: string; v2?: boolean }[] = [
  { id: 'rig', label: 'Rig' },
  { id: 'pose', label: 'Pose' },
  { id: 'deform', label: 'Deform', v2: true },
]

function depthOf(bones: Bone[], id: string): number {
  const byId = new Map(bones.map(b => [b.id, b]))
  let d = 0, cur = byId.get(id)
  const seen = new Set<string>()
  while (cur?.parent && !seen.has(cur.id)) { seen.add(cur.id); d++; cur = byId.get(cur.parent) }
  return d
}

function nextBoneId(bones: Bone[]): string {
  const n = bones.reduce((m, b) => Math.max(m, /^b\d+$/.test(b.id) ? parseInt(b.id.slice(1), 10) : 0), 0)
  return `b${n + 1}`
}

function humanoidDoc(assetId: string): RigDoc {
  return { schema: 'animatory.rig/v1', assetId, skeleton: buildHumanoid(), clips: [{ name: 'action_01', duration_s: 1, keyframes: [] }] }
}

// ── small dark-surface chrome ────────────────────────────────────────────────
function ToolButton({ icon, children, onClick, active, primary, disabled, loading }: {
  icon: IconName; children: React.ReactNode; onClick?: () => void
  active?: boolean; primary?: boolean; disabled?: boolean; loading?: boolean
}) {
  const tone = primary
    ? 'border-transparent bg-[#3772cf] text-white hover:bg-[#2c5cab]'
    : active
      ? 'border-[#3772cf] bg-[#3772cf]/[0.16] text-[#cfe0fb]'
      : 'border-white/[0.13] text-[#d4dbe2] hover:bg-white/[0.06] hover:border-white/20'
  return (
    <button onClick={onClick} disabled={disabled || loading} aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${RING}`}>
      <Icon name={loading ? 'refresh' : icon} size={15} className={loading ? 'animate-spin' : undefined} />
      {children}
    </button>
  )
}

function PaneHead({ eyebrow, count }: { eyebrow: string; count?: string }) {
  return (
    <div className="flex flex-none items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#59626d]">{eyebrow}</span>
      {count != null && <span className="rounded-full bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-[#59626d]">{count}</span>}
    </div>
  )
}

function Field({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#59626d]">{label}</span>
        {value != null && <span className="font-mono text-[13px] text-[#d4dbe2]">{value}</span>}
      </div>
      {children}
    </div>
  )
}

export function RigEditorView() {
  const { id = '', assetId = '' } = useParams()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(rigReducer, assetId, aid => initRigState(emptyRig(aid)))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [drawing, setDrawing] = useState(false) // drag-to-draw tool (rig mode)
  const [loop, setLoop] = useState(true)
  const [charName, setCharName] = useState('')
  const [scrubbing, setScrubbing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const accRef = useRef(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    studioApi.getRig(assetId)
      .then(doc => { if (alive) { dispatch({ type: 'load', doc }); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [assetId])

  // crumb label — best-effort; falls back to the id
  useEffect(() => {
    let alive = true
    loadDesignAssets(id)
      .then(all => { if (alive) setCharName(all.find(a => a.id === assetId)?.displayName ?? '') })
      .catch(() => {})
    return () => { alive = false }
  }, [id, assetId])

  // playback loop — advance the playhead; stop at the end unless looping
  useEffect(() => {
    if (!state.playing) return
    accRef.current = state.scrub * state.clip.duration_s
    let raf = 0, prev = performance.now()
    const tick = (now: number) => {
      const dt = (now - prev) / 1000; prev = now
      let t = accRef.current + dt
      if (t >= state.clip.duration_s) {
        if (loop) { t %= state.clip.duration_s }
        else { dispatch({ type: 'setScrub', t: 1 }); dispatch({ type: 'pause' }); return }
      }
      accRef.current = t
      dispatch({ type: 'setScrub', t: t / state.clip.duration_s })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playing, state.clip.duration_s, loop])

  const selected = state.bones.find(b => b.id === state.selectedBoneId) ?? null
  const canPlay = state.clip.keyframes.length >= 2
  const kfAtScrub = state.clip.keyframes.find(k => Math.abs(k.t - state.scrub) < 1e-3)

  // a bone dragged out on the stage — assign id/name, store the drawn geometry
  function drawBone(g: DrawnBone) {
    const idNew = nextBoneId(state.bones)
    const name = g.parent ? `bone_${idNew}` : state.bones.length === 0 ? 'root' : `root_${idNew}`
    dispatch({ type: 'addBone', bone: { id: idNew, name, parent: g.parent, x: g.x, y: g.y, len: g.len, angle: g.angle, mesh: null } })
  }

  function importCharacter() { dispatch({ type: 'load', doc: humanoidDoc(assetId) }); dispatch({ type: 'markDirty' }); setDrawing(false) }
  function clearBones() { dispatch({ type: 'load', doc: emptyRig(assetId) }); dispatch({ type: 'markDirty' }); setDrawing(true) }

  function exportJson() {
    const blob = new Blob([JSON.stringify(toRigDoc(state), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${assetId || 'rig'}.rig.json`; a.click()
    URL.revokeObjectURL(url)
  }

  function importJson(file: File) {
    file.text().then(txt => {
      const doc = JSON.parse(txt) as RigDoc
      if (doc?.schema !== 'animatory.rig/v1' || !Array.isArray(doc.skeleton)) throw new Error('Not an animatory.rig/v1 document')
      dispatch({ type: 'load', doc }); dispatch({ type: 'markDirty' })
      setError('')
    }).catch(e => setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`))
  }

  async function save() {
    setSaving(true); setError('')
    try { await studioApi.saveRig(toRigDoc(state)); dispatch({ type: 'markClean' }) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  function playToggle() {
    if (!canPlay) return
    if (state.scrub >= 1) dispatch({ type: 'setScrub', t: 0 })
    dispatch({ type: state.playing ? 'pause' : 'play' })
  }

  function seek(clientX: number) {
    const el = trackRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    dispatch({ type: 'setScrub', t: Math.max(0, Math.min(1, (clientX - r.left) / r.width)) })
  }
  function onTrackDown(e: React.PointerEvent) { dispatch({ type: 'pause' }); setScrubbing(true); seek(e.clientX); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  function onTrackMove(e: React.PointerEvent) { if (scrubbing) seek(e.clientX) }
  function onTrackUp() { setScrubbing(false) }

  // Full-screen editor: pinned to the content region — right of the 208px studio
  // nav (w-52) and below the 60px app header — so it owns the viewport and never
  // fights the scroll container's padding. (Couples to AppShell's nav/header size.)
  const surface = 'fixed bottom-0 right-0 left-52 top-[60px] z-10 flex flex-col bg-[#0f1419] text-[#d4dbe2]'
  if (loading) return <div className={`${surface} items-center justify-center text-sm text-white/50`} aria-busy="true">Loading rig…</div>

  const poseDelta = selected ? toDeg(state.pose[selected.id] ?? 0) : 0

  return (
    <div className={surface}>
      {/* HEADER */}
      <header className="flex h-[52px] flex-none items-center gap-5 border-b border-white/[0.07] bg-[#11161c] px-5">
        <button onClick={() => navigate(`/project/${id}/pre/design`)}
          className={`inline-flex items-center gap-1 rounded text-sm font-medium text-[#8a939d] transition-colors hover:text-[#d4dbe2] ${RING}`}>
          <Icon name="chevron-right" size={15} className="rotate-180" /> Design
        </button>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold tracking-tight text-[#eef2f5]">{charName || 'Rig editor'}</span>
          <span className="font-mono text-xs text-[#59626d]">{assetId || '—'}</span>
        </div>

        {/* mode switch */}
        <div className="flex gap-0.5 rounded-md border border-white/[0.07] bg-[#0c1116] p-[3px]" role="tablist" aria-label="Editor mode">
          {MODES.map(m => {
            const active = state.mode === m.id
            return (
              <button key={m.id} role="tab" aria-selected={active} disabled={m.v2}
                title={m.v2 ? 'Mesh deformation — v2 (no-op in v1)' : undefined}
                onClick={() => { if (m.v2) return; dispatch({ type: 'setMode', mode: m.id }); if (m.id !== 'rig') setDrawing(false) }}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${RING} ${
                  active ? 'bg-[#3772cf] text-white' : m.v2 ? 'cursor-not-allowed text-[#59626d]' : 'text-[#8a939d] hover:bg-white/[0.04] hover:text-[#d4dbe2]'
                }`}>
                {m.label}
                {m.v2 && <span className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[9px] text-[#59626d]">V2</span>}
              </button>
            )
          })}
        </div>

        {/* tools */}
        <div className="ml-auto flex items-center gap-2">
          <ToolButton icon="plus" onClick={() => setDrawing(d => !d)} active={drawing && state.mode === 'rig'} disabled={state.mode !== 'rig'}>
            {drawing && state.mode === 'rig' ? 'Drawing…' : 'Draw bone'}
          </ToolButton>
          <ToolButton icon="upload" onClick={importCharacter}>Import character</ToolButton>
          <ToolButton icon="x" onClick={clearBones} disabled={state.bones.length === 0}>Clear bones</ToolButton>
          <span className="h-5 w-px bg-white/[0.13]" />
          <ToolButton icon="plus" primary onClick={() => dispatch({ type: 'addKeyframe' })} disabled={state.bones.length === 0}>Add keyframe</ToolButton>
          <input ref={fileRef} type="file" accept="application/json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = '' }} />
          <ToolButton icon="upload" onClick={() => fileRef.current?.click()}>Import JSON</ToolButton>
          <ToolButton icon="download" onClick={exportJson}>Export</ToolButton>
          <ToolButton icon="check" primary onClick={save} disabled={!state.dirty} loading={saving}>{state.dirty ? 'Save' : 'Saved'}</ToolButton>
        </div>
      </header>

      {error && <div className="flex-none border-b border-white/[0.07] bg-[#d45656]/10 px-5 py-2 text-xs text-[#e88981]">{error}</div>}

      {/* BODY: hierarchy | stage | inspector */}
      <div className="grid min-h-0 flex-1 grid-cols-[252px_1fr_304px]">
        {/* hierarchy */}
        <aside className="flex min-h-0 flex-col border-r border-white/[0.07] bg-[#151a20]">
          <PaneHead eyebrow="Hierarchy" count={`${state.bones.length} bones`} />
          <div className="min-h-0 flex-1 overflow-auto py-2">
            {state.bones.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-[#59626d]">
                <Icon name="layers" size={22} />
                <span>No skeleton yet — turn on <b className="font-medium text-[#8a939d]">Draw bone</b> and drag on the stage, or import a character.</span>
              </div>
            ) : state.bones.map(b => {
              const sel = b.id === state.selectedBoneId
              const posed = Math.abs(state.pose[b.id] ?? 0) > POSED_EPS
              return (
                <button key={b.id} onClick={() => dispatch({ type: 'selectBone', id: b.id })}
                  style={{ paddingLeft: 16 + depthOf(state.bones, b.id) * 14 }}
                  className={`flex w-full items-center gap-3 py-1.5 pr-4 text-left text-sm transition-colors ${RING} ${
                    sel ? 'bg-[#3772cf]/[0.16] text-[#eef2f5] shadow-[inset_2px_0_0_#3772cf]' : 'text-[#8a939d] hover:bg-white/[0.04] hover:text-[#d4dbe2]'
                  }`}>
                  <span className={`h-1.5 w-1.5 flex-none rounded-full ${posed ? 'bg-[#00d4a4]' : sel ? 'bg-[#5689d8]' : 'bg-[#59626d]'}`} />
                  <span className="flex-1 truncate">{b.name}</span>
                  <span className="flex-none font-mono text-[11px] text-[#59626d]">{b.id}</span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* stage — drag to draw bones (rig) or pose tip handles (pose) */}
        <section className="relative min-h-0">
          <RigStage bones={state.bones} pose={previewPose(state)}
            selectedBoneId={state.selectedBoneId} onSelectBone={bid => dispatch({ type: 'selectBone', id: bid })}
            mode={state.mode} live={state.playing} drawing={drawing}
            onPoseBone={(boneId, delta) => dispatch({ type: 'setPoseDelta', id: boneId, delta })}
            onDrawBone={drawBone} />
        </section>

        {/* inspector */}
        <aside className="flex min-h-0 flex-col border-l border-white/[0.07] bg-[#151a20]">
          <PaneHead eyebrow="Inspector" count={selected?.id} />
          <div className="min-h-0 flex-1 overflow-auto">
            {state.mode === 'deform' ? (
              <div className="m-6 rounded-md border border-dashed border-white/[0.13] p-4 text-center">
                <span className="inline-block rounded bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-[#59626d]">V2</span>
                <p className="mt-2 text-xs text-[#59626d]">Mesh deformation &amp; weight painting land in v2. Bones stay rigid in v1 — nothing to deform here yet.</p>
              </div>
            ) : !selected ? (
              <p className="px-6 py-12 text-center text-sm text-[#59626d]">
                {state.bones.length ? 'Select a bone from the hierarchy or stage to inspect it.' : 'No bones yet — draw one on the stage to begin.'}
              </p>
            ) : (
              <div className="flex flex-col gap-7 p-6">
                <Field label="Name">
                  <input value={selected.name} onChange={e => dispatch({ type: 'updateBone', id: selected.id, patch: { name: e.target.value } })}
                    className={`h-9 w-full rounded-md border border-white/[0.13] bg-[#0c1116] px-3 text-[13px] text-[#d4dbe2] transition-colors hover:border-white/20 focus:border-[#3772cf] focus:outline-none focus:ring-2 focus:ring-[#3772cf]/30`} />
                </Field>
                <Field label="Length" value={`${Math.round(selected.len)}px`}>
                  <input type="range" min={10} max={120} step={1} value={Math.round(selected.len)}
                    onChange={e => dispatch({ type: 'updateBone', id: selected.id, patch: { len: Number(e.target.value) } })}
                    className="w-full accent-[#3772cf]" aria-label="Bone length" />
                </Field>
                <Field label="Rest angle" value={`${toDeg(selected.angle)}°`}>
                  <input type="range" min={-180} max={180} step={1} value={toDeg(selected.angle)}
                    onChange={e => dispatch({ type: 'updateBone', id: selected.id, patch: { angle: toRad(Number(e.target.value)) } })}
                    className="w-full accent-[#3772cf]" aria-label="Rest angle" />
                </Field>

                <div className="flex items-center justify-between rounded-md border border-[#00d4a4]/[0.28] bg-[#00d4a4]/[0.07] px-4 py-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a939d]">Pose Δ</span>
                  <span className="font-mono text-[15px] font-semibold text-[#00d4a4]">{poseDelta > 0 ? '+' : ''}{poseDelta}°</span>
                </div>

                <div className="flex items-center justify-between rounded-md border border-dashed border-white/[0.13] px-4 py-3 text-[#59626d] opacity-75">
                  <span className="text-sm">Mesh — none</span>
                  <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px]">V2</span>
                </div>

                {poseDelta !== 0 && (
                  <button onClick={() => dispatch({ type: 'resetPose' })}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-white/[0.13] py-2 text-sm font-medium text-[#8a939d] transition-colors hover:bg-white/[0.05] hover:text-[#d4dbe2] ${RING}`}>
                    <Icon name="refresh" size={13} /> Reset pose
                  </button>
                )}
                {isDrawn(selected.id) && (
                  <button onClick={() => dispatch({ type: 'removeBone', id: selected.id })}
                    className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#d45656]/[0.34] text-sm font-medium text-[#e88981] transition-colors hover:border-[#d45656]/50 hover:bg-[#d45656]/[0.12] ${RING}`}>
                    <Icon name="x" size={14} /> Delete bone &amp; children
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* TIMELINE */}
      <div className="flex-none border-t border-white/[0.07] bg-[#11161c] px-7 py-5">
        <div className="mb-5 flex items-center gap-5">
          <button onClick={playToggle} disabled={!canPlay} aria-label={state.playing ? 'Pause' : 'Play'}
            className={`grid h-9 w-9 place-items-center rounded-full bg-[#00d4a4] text-[#06231c] transition hover:brightness-110 disabled:opacity-40 ${RING}`}>
            <Icon name={state.playing ? 'pause' : 'play'} size={17} />
          </button>
          <button onClick={() => setLoop(l => !l)} aria-label="Loop" aria-pressed={loop}
            className={`grid h-8 w-8 place-items-center rounded-md border transition-colors ${RING} ${loop ? 'border-[#00d4a4]/40 bg-[#00d4a4]/[0.08] text-[#00d4a4]' : 'border-white/[0.13] text-[#8a939d] hover:text-[#d4dbe2]'}`}>
            <Icon name="refresh" size={15} />
          </button>
          <span className="font-mono text-sm text-[#d4dbe2]">
            {(state.scrub * state.clip.duration_s).toFixed(2)}<span className="text-[#59626d]"> / {state.clip.duration_s.toFixed(2)}s</span>
          </span>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#59626d]">
            Dur
            <input type="number" step={0.1} min={0.1} value={state.clip.duration_s}
              onChange={e => dispatch({ type: 'setDuration', seconds: Number(e.target.value) || 1 })}
              className="w-14 rounded border border-white/[0.13] bg-[#0c1116] px-2 py-1 font-mono text-xs text-[#d4dbe2] focus:border-[#3772cf] focus:outline-none" />
          </label>
          <span className="flex-1" />
          {kfAtScrub && (
            <button onClick={() => dispatch({ type: 'removeKeyframe', t: kfAtScrub.t })}
              className={`inline-flex items-center gap-1.5 rounded-md border border-white/[0.13] px-3 py-1.5 text-xs font-medium text-[#8a939d] transition-colors hover:bg-white/[0.05] hover:text-[#d4dbe2] ${RING}`}>
              <Icon name="x" size={13} /> Remove key
            </button>
          )}
          <span className="font-mono text-xs text-[#8a939d]"><b className="text-[#d4dbe2]">{state.clip.keyframes.length}</b> keyframe{state.clip.keyframes.length === 1 ? '' : 's'}</span>
        </div>

        {/* ruler + track lane */}
        <div className="relative">
          <div className="relative mb-1 h-4">
            {[0, 0.25, 0.5, 0.75, 1].map(p => (
              <span key={p} className="absolute top-0 font-mono text-[10px] text-[#59626d]" style={{ left: `${p * 100}%`, transform: 'translateX(2px)' }}>
                {(p * state.clip.duration_s).toFixed(2)}
              </span>
            ))}
          </div>
          <div ref={trackRef} onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp}
            className="relative h-10 cursor-pointer rounded-md border border-white/[0.07] bg-white/[0.03]">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-[#59626d]">root</span>
            {state.clip.keyframes.map(k => (
              <button key={k.t} onPointerDown={e => { e.stopPropagation(); dispatch({ type: 'pause' }); dispatch({ type: 'setScrub', t: k.t }) }}
                aria-label={`Keyframe at ${(k.t * state.clip.duration_s).toFixed(2)}s`} title={`${(k.t * state.clip.duration_s).toFixed(2)}s`}
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border border-[#0c1116] bg-[#5689d8] transition-transform hover:bg-white ${Math.abs(k.t - state.scrub) < 0.02 ? 'scale-[1.15]' : ''}`}
                style={{ left: `${k.t * 100}%` }} />
            ))}
            <span className="pointer-events-none absolute -top-[18px] bottom-0 w-0.5 bg-[#00d4a4] shadow-[0_0_8px_rgba(0,212,164,0.5)]" style={{ left: `${state.scrub * 100}%` }}>
              <span className="absolute -top-1.5 left-1/2 h-[11px] w-[11px] -translate-x-1/2 rounded-full bg-[#00d4a4] shadow-[0_0_0_3px_rgba(0,212,164,0.22)]" />
            </span>
          </div>
          {!canPlay && <p className="mt-2 text-[11px] text-[#59626d]">Capture at least two keyframes to play a tween.</p>}
        </div>
      </div>
    </div>
  )
}
