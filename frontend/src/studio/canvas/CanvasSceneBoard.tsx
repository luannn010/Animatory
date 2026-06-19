import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../api'
import { Icon } from '../ui/Icon'
import { type CanvasScene, type CanvasShot, sceneById, animatedCount, seedCanvasScenes } from './canvasData'
import { StatusPill } from './StatusPill'
import { ShotThumb, RATIO_KEYS, type RatioKey } from './ShotThumb'

/** `/pre/canvas` → the first scene's board. */
export function CanvasIndexRedirect() {
  return <Navigate to={seedCanvasScenes()[0].id} replace />
}

const sceneNo = (id: string) => `Scene ${id.split('-')[1] ?? ''}`

function ShotCard({ projectId, scene, shot, ratio }: { projectId: string; scene: CanvasScene; shot: CanvasShot; ratio: RatioKey }) {
  const navigate = useNavigate()
  return (
    <div className="ppc-shot">
      <div className="ppc-shot__frame" onClick={() => navigate(`/project/${projectId}/pre/canvas/${scene.id}/${shot.id}`)}>
        <ShotThumb shot={shot} ratio={ratio} />
        <div className="ppc-shot__badges"><StatusPill status={shot.status} /></div>
        <span className="ppc-shot__num">{shot.id}</span>
        <div className="ppc-shot__open-ghost"><Icon name="pencil" size={16} /> Open shot</div>
      </div>
      <div className="ppc-shot__body">
        <div className="ppc-fld">
          <span className="ppc-fld__k">Action</span>
          <span className="ppc-fld__v">{shot.action}</span>
        </div>
        <div className="ppc-fld">
          <span className="ppc-fld__k">Dialogue</span>
          <span className={`ppc-fld__v${shot.dialogue ? '' : ' is-dim'}`}>{shot.dialogue || '— none —'}</span>
        </div>
        <div className="ppc-shot__grid2">
          <div className="ppc-fld"><span className="ppc-fld__k">Camera / FX</span><span className="ppc-fld__v">{shot.camera}</span></div>
          <div className="ppc-fld"><span className="ppc-fld__k">Duration</span><span className="ppc-fld__v is-mono">{shot.duration}</span></div>
        </div>
        <div className="ppc-fld"><span className="ppc-fld__k">SFX</span><span className="ppc-fld__v is-mono">{shot.sfx}</span></div>
      </div>
      <div className="ppc-shot__foot">
        {/* Rig Studio lands in Step 2 */}
        <button className="ppc-shot__open" disabled title="Rig Studio — Step 2">Open Studio <Icon name="arrow-right" size={15} /></button>
        <span className="ppc-shot__dur ppc-mono">{shot.baked ? '● baked' : '○ no clip'}</span>
      </div>
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="ppc ppc-board">
      <div className="ppc-board__bar"><span className="ppc-board__title">Pre-Production Canvas</span></div>
      <div className="ppc-board__body">
        <aside className="ppc-rail" />
        <main className="ppc-shots">
          <div className="ppc-shotgrid">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="anmt-skeleton" style={{ minHeight: 280, borderRadius: 8 }} />)}
          </div>
        </main>
      </div>
    </div>
  )
}

export function CanvasSceneBoard() {
  const { id = '', sceneId } = useParams()
  const navigate = useNavigate()
  const [scenes, setScenes] = useState<CanvasScene[] | null>(null)
  const [error, setError] = useState('')
  const [ratio, setRatio] = useState<RatioKey>('16:9')

  useEffect(() => {
    let alive = true
    setScenes(null); setError('')
    studioApi.getCanvasScenes(id)
      .then(s => { if (alive) setScenes(s) })
      .catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [id])

  if (error) {
    return (
      <div className="ppc ppc-board">
        <div className="ppc-board__bar"><span className="ppc-board__title">Pre-Production Canvas</span></div>
        <p style={{ padding: 22, color: 'var(--st-extracted)' }}>{error}</p>
      </div>
    )
  }
  if (!scenes) return <BoardSkeleton />
  if (scenes.length === 0) {
    return (
      <div className="ppc ppc-board">
        <div className="ppc-board__bar"><span className="ppc-board__title">Pre-Production Canvas</span></div>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <p>No scenes yet — parse a script to populate the board.</p>
        </div>
      </div>
    )
  }

  const scene = sceneById(scenes, sceneId)
  return (
    <div className="ppc ppc-board">
      <div className="ppc-board__bar">
        <span className="ppc-board__title">Pre-Production Canvas</span>
        <div className="ppc-crumb">
          <span>Project</span><span className="ppc-crumb__sep">/</span>
          <b>{sceneNo(scene.id)}</b><span className="ppc-crumb__sep">/</span><span>—</span>
        </div>
        <span className="ppc-board__spacer" />
        <div className="ppc-ratio" role="radiogroup" aria-label="Frame ratio">
          {RATIO_KEYS.map(r => (
            <button key={r} role="radio" aria-checked={ratio === r}
              className={`ppc-ratio__b${ratio === r ? ' is-on' : ''}`} onClick={() => setRatio(r)}>{r}</button>
          ))}
        </div>
      </div>

      <div className="ppc-board__body">
        {/* scene rail */}
        <aside className="ppc-rail">
          <div className="ppc-rail__head">
            <span className="ppc-eyebrow">Scenes</span>
            <span className="ppc-eyebrow">{scenes.length}</span>
          </div>
          <div className="ppc-rail__list">
            {scenes.map(s => {
              const total = s.shots.length
              const anim = animatedCount(s)
              return (
                <button key={s.id} className={`ppc-scene${s.id === scene.id ? ' is-active' : ''}`}
                  onClick={() => navigate(`/project/${id}/pre/canvas/${s.id}`)}>
                  <div className="ppc-scene__top">
                    <span className="ppc-scene__id">{s.id}</span>
                    <StatusPill status={s.status} />
                  </div>
                  <div className="ppc-scene__loc">{s.slug}</div>
                  <div className="ppc-scene__meta">
                    <span className="ppc-eyebrow">{anim}/{total} animated</span>
                    <span className="ppc-scene__count">{total} {total === 1 ? 'shot' : 'shots'}</span>
                  </div>
                  <div className="ppc-prog"><div className="ppc-prog__fill" style={{ width: `${total ? (anim / total) * 100 : 0}%` }} /></div>
                </button>
              )
            })}
          </div>
        </aside>

        {/* shot grid */}
        <main className="ppc-shots">
          <div className="ppc-shots__head">
            <span className="ppc-shots__h ppc-mono">{scene.id}</span>
            <span className="ppc-shots__sub">{scene.slug}</span>
          </div>
          <div className="ppc-shotgrid">
            {scene.shots.map(sh => <ShotCard key={sh.id} projectId={id} scene={scene} shot={sh} ratio={ratio} />)}
            <button className="ppc-addshot" title="Add a shot — coming soon"><Icon name="plus" size={22} /> Add Shot</button>
          </div>
        </main>
      </div>
    </div>
  )
}
