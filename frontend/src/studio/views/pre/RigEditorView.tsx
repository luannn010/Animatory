import { useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { Bone, RigDoc, RigMode } from '../../types'
import { rigReducer, initRigState, emptyRig, toRigDoc, previewPose } from '../../rig/rigReducer'
import { resolveBone } from '../../rig/fk'
import { RigStage, type DrawnBone } from '../../rig/RigStage'
import { Button, Icon, BackLink } from '../../ui'

const DEG = 180 / Math.PI
const toDeg = (r: number) => Math.round(r * DEG)
const toRad = (d: number) => d / DEG
const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

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
  const n = bones.reduce((m, b) => Math.max(m, parseInt(b.id.replace(/\D/g, ''), 10) || 0), 0)
  return `b${n + 1}`
}

export function RigEditorView() {
  const { id = '', assetId = '' } = useParams()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(rigReducer, assetId, aid => initRigState(emptyRig(aid)))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [drawing, setDrawing] = useState(false)   // drag-to-draw tool (rig mode)
  const fileRef = useRef<HTMLInputElement>(null)
  const accRef = useRef(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    studioApi.getRig(assetId)
      .then(doc => { if (alive) { dispatch({ type: 'load', doc }); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [assetId])

  // playback loop — advance the playhead over duration_s, looping
  useEffect(() => {
    if (!state.playing) return
    accRef.current = state.scrub * state.clip.duration_s
    let raf = 0, prev = performance.now()
    const tick = (now: number) => {
      const dt = (now - prev) / 1000; prev = now
      accRef.current = (accRef.current + dt) % state.clip.duration_s
      dispatch({ type: 'setScrub', t: accRef.current / state.clip.duration_s })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playing, state.clip.duration_s])

  const selected = state.bones.find(b => b.id === state.selectedBoneId) ?? null
  const canPlay = state.clip.keyframes.length >= 2
  const kfAtScrub = state.clip.keyframes.find(k => Math.abs(k.t - state.scrub) < 1e-3)

  function addBone() {
    const idNew = nextBoneId(state.bones)
    if (state.bones.length === 0) {
      dispatch({ type: 'addBone', bone: { id: idNew, name: 'root', parent: null, x: 260, y: 320, len: 90, angle: -Math.PI / 2, mesh: null } })
      return
    }
    const parentId = state.selectedBoneId ?? state.bones[state.bones.length - 1].id
    const parent = state.bones.find(b => b.id === parentId)!
    const tip = resolveBone(parentId, state.bones, state.pose)
    dispatch({ type: 'addBone', bone: { id: idNew, name: `bone_${idNew}`, parent: parentId, x: tip.tipX, y: tip.tipY, len: 60, angle: parent.angle, mesh: null } })
  }

  // a bone dragged out on the stage — assign id/name, store the drawn geometry
  function drawBone(g: DrawnBone) {
    const idNew = nextBoneId(state.bones)
    const name = g.parent ? `bone_${idNew}` : state.bones.length === 0 ? 'root' : `root_${idNew}`
    dispatch({ type: 'addBone', bone: { id: idNew, name, parent: g.parent, x: g.x, y: g.y, len: g.len, angle: g.angle, mesh: null } })
  }

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
      dispatch({ type: 'load', doc })
      setError('')
    }).catch(e => setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`))
  }

  async function save() {
    setSaving(true); setError('')
    try { await studioApi.saveRig(toRigDoc(state)); dispatch({ type: 'markClean' }) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="h-[520px] rounded-lg anmt-skeleton" aria-hidden="true" />

  return (
    <div>
      <BackLink onClick={() => navigate(`/project/${id}/pre/design`)}>Design</BackLink>

      {/* header */}
      <div className="mt-3 mb-4 flex flex-wrap items-center gap-3 border-b border-hairline pb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Rig editor</h1>
          <span className="font-mono text-xs text-stone">{assetId || '—'} · bones-only v1</span>
        </div>

        {/* mode switcher */}
        <div className="flex items-center gap-0.5 rounded-md border border-hairline p-0.5" role="tablist" aria-label="Editor mode">
          {MODES.map(m => {
            const active = state.mode === m.id
            return (
              <button key={m.id} role="tab" aria-selected={active} onClick={() => { dispatch({ type: 'setMode', mode: m.id }); if (m.id !== 'rig') setDrawing(false) }}
                title={m.v2 ? 'Mesh deformation — v2 (no-op in v1)' : undefined}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium transition-colors ${ring} ${
                  active ? 'bg-[#3772cf] text-white' : m.v2 ? 'text-muted hover:bg-surface' : 'text-steel hover:bg-surface'
                }`}>
                {m.label}
                {m.v2 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${active ? 'bg-white/20 text-white' : 'bg-surface text-stone'}`}>V2</span>}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {state.mode === 'rig' && (
            <Button size="sm" variant={drawing ? 'primary' : 'secondary'} icon="plus"
              onClick={() => setDrawing(d => !d)}>
              {drawing ? 'Drawing…' : 'Draw bone'}
            </Button>
          )}
          <input ref={fileRef} type="file" accept="application/json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = '' }} />
          <Button size="sm" variant="ghost" icon="upload" onClick={() => fileRef.current?.click()}>Import</Button>
          <Button size="sm" variant="secondary" icon="download" onClick={exportJson}>Export</Button>
          <Button size="sm" variant="primary" icon="check" loading={saving} disabled={!state.dirty} onClick={save}>
            {state.dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-brand-error">{error}</p>}

      {/* body: tree · stage · inspector */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[210px_1fr_240px]">
        {/* hierarchy tree */}
        <aside>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-mono uppercase tracking-wider text-[#3772cf]">Skeleton</h2>
            {state.mode === 'rig' && (
              <button onClick={addBone} aria-label="Add bone"
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[#3772cf] hover:bg-surface transition-colors ${ring}`}>
                <Icon name="plus" size={14} /> {state.bones.length === 0 ? 'Root' : 'Child'}
              </button>
            )}
          </div>
          {state.bones.length === 0 ? (
            <p className="text-xs text-stone">Empty. Add a root bone to begin.</p>
          ) : (
            <ul className="space-y-0.5">
              {state.bones.map(b => {
                const sel = b.id === state.selectedBoneId
                return (
                  <li key={b.id}>
                    <button onClick={() => dispatch({ type: 'selectBone', id: b.id })}
                      style={{ paddingLeft: 8 + depthOf(state.bones, b.id) * 14 }}
                      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs transition-colors ${ring} ${
                        sel ? 'bg-[#3772cf]/10 text-[#3772cf]' : 'text-steel hover:bg-surface'
                      }`}>
                      <span className="font-mono text-[10px] text-stone">{b.id}</span>
                      <span className="truncate">{b.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* interactive stage — drag to draw bones (rig) or pose tip handles (pose) */}
        <RigStage bones={state.bones} pose={previewPose(state)}
          selectedBoneId={state.selectedBoneId} onSelectBone={id => dispatch({ type: 'selectBone', id })}
          mode={state.mode} live={state.playing} drawing={drawing}
          onPoseBone={(boneId, delta) => dispatch({ type: 'setPoseDelta', id: boneId, delta })}
          onDrawBone={drawBone} />

        {/* inspector */}
        <aside>
          <h2 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-[#3772cf]">Inspector</h2>

          {state.mode === 'deform' ? (
            <div className="rounded-lg border border-dashed border-hairline p-4 text-center">
              <span className="inline-block rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-stone">V2</span>
              <p className="mt-2 text-xs text-stone">Mesh deformation &amp; weight painting land in v2. Bones stay rigid in v1 — nothing to deform here yet.</p>
            </div>
          ) : !selected ? (
            <p className="text-xs text-stone">Select a bone to {state.mode === 'pose' ? 'pose' : 'edit'} it.</p>
          ) : state.mode === 'rig' ? (
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-stone">Name</span>
                <input value={selected.name} onChange={e => dispatch({ type: 'updateBone', id: selected.id, patch: { name: e.target.value } })}
                  className={`w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink ${ring}`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-stone">Length (px)</span>
                <input type="number" value={Math.round(selected.len)} onChange={e => dispatch({ type: 'updateBone', id: selected.id, patch: { len: Number(e.target.value) || 0 } })}
                  className={`w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink font-mono ${ring}`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-stone">Rest angle (°)</span>
                <input type="number" value={toDeg(selected.angle)} onChange={e => dispatch({ type: 'updateBone', id: selected.id, patch: { angle: toRad(Number(e.target.value) || 0) } })}
                  className={`w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink font-mono ${ring}`} />
              </label>
              <button onClick={() => dispatch({ type: 'removeBone', id: selected.id })}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-error hover:bg-surface transition-colors ${ring}`}>
                <Icon name="x" size={13} /> Remove bone &amp; children
              </button>
            </div>
          ) : (
            // pose mode — FK rotate the selected bone; readout in teal (live)
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-steel">{selected.name}</span>
                <span className="font-mono text-xs text-[#00d4a4]">Δ {toDeg(state.pose[selected.id] ?? 0)}°</span>
              </div>
              <input type="range" min={-180} max={180} step={1} value={toDeg(state.pose[selected.id] ?? 0)}
                onChange={e => dispatch({ type: 'setPoseDelta', id: selected.id, delta: toRad(Number(e.target.value)) })}
                className="w-full accent-[#3772cf]" aria-label="Pose angle delta" />
              <button onClick={() => dispatch({ type: 'resetPose' })}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-steel hover:bg-surface transition-colors ${ring}`}>
                <Icon name="refresh" size={13} /> Reset pose
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* timeline */}
      <div className="mt-5 rounded-lg border border-hairline bg-canvas p-4">
        <div className="mb-3 flex items-center gap-3">
          <button onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })} disabled={!canPlay}
            aria-label={state.playing ? 'Pause' : 'Play'}
            className={`grid h-8 w-8 place-items-center rounded-full text-white transition-colors disabled:opacity-40 ${state.playing ? 'bg-[#00d4a4] hover:bg-[#00b48a]' : 'bg-[#3772cf] hover:bg-[#2c5cab]'} ${ring}`}>
            <Icon name={state.playing ? 'pause' : 'play'} size={15} />
          </button>
          <span className="font-mono text-xs text-[#00d4a4]">{(state.scrub * state.clip.duration_s).toFixed(2)}s</span>
          <span className="font-mono text-xs text-stone">/ {state.clip.duration_s.toFixed(1)}s</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-stone">
              Duration
              <input type="number" step={0.1} min={0.1} value={state.clip.duration_s}
                onChange={e => dispatch({ type: 'setDuration', seconds: Number(e.target.value) || 1 })}
                className={`w-16 rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-mono text-ink ${ring}`} />
            </label>
            {kfAtScrub
              ? <Button size="sm" variant="ghost" icon="x" onClick={() => dispatch({ type: 'removeKeyframe', t: kfAtScrub.t })}>Remove key</Button>
              : <Button size="sm" variant="secondary" icon="plus" onClick={() => dispatch({ type: 'addKeyframe' })}>Add keyframe</Button>}
          </div>
        </div>

        {/* scrub track with keyframe markers + playhead */}
        <div className="relative h-8">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-hairline" />
          {state.clip.keyframes.map(k => (
            <button key={k.t} onClick={() => { dispatch({ type: 'pause' }); dispatch({ type: 'setScrub', t: k.t }) }}
              aria-label={`Keyframe at ${(k.t * state.clip.duration_s).toFixed(2)}s`}
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 border-canvas bg-[#3772cf] hover:scale-110 transition-transform"
              style={{ left: `${k.t * 100}%` }} />
          ))}
          <input type="range" min={0} max={1} step={0.001} value={state.scrub}
            onChange={e => { dispatch({ type: 'pause' }); dispatch({ type: 'setScrub', t: Number(e.target.value) }) }}
            className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent accent-[#00d4a4]" aria-label="Scrub playhead" />
        </div>
        {!canPlay && <p className="mt-2 text-[11px] text-stone">Capture at least two keyframes to play a tween.</p>}
      </div>
    </div>
  )
}
