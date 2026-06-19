import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../api'
import { Icon } from '../ui/Icon'
import { type CanvasScene, type CanvasShot, sceneById, shotById } from './canvasData'
import { StatusPill } from './StatusPill'
import { PaperSketch } from './PaperSketch'

function ShotDetailBody({ projectId, scene, shot }: { projectId: string; scene: CanvasScene; shot: CanvasShot }) {
  const navigate = useNavigate()
  const [clear, setClear] = useState(0)
  const [action, setAction] = useState(shot.action)
  const [dialogue, setDialogue] = useState(shot.dialogue)
  const sceneNo = `Scene ${scene.id.split('-')[1] ?? ''}`
  const shotNo = `Shot ${shot.id.slice(-3)}`

  return (
    <div className="ppc ppc-shotview">
      <div className="ppc-shotview__bar">
        <button className="ppc-back" onClick={() => navigate(`/project/${projectId}/pre/canvas/${scene.id}`)}>
          <Icon name="chevron-right" size={15} className="rotate-180" /> Back to Board
        </button>
        <div className="ppc-crumb">
          <span>Project</span><span className="ppc-crumb__sep">/</span>
          <b>{sceneNo}</b><span className="ppc-crumb__sep">/</span><b>{shotNo}</b>
        </div>
        <span className="ppc-board__spacer" />
        {/* Rig Studio lands in Step 2 */}
        <button className="ppc-btn is-primary" disabled title="Rig Studio — Step 2">Open Studio <Icon name="arrow-right" size={16} /></button>
      </div>

      <div className="ppc-shotview__body">
        <div className="ppc-stage-wrap">
          <div style={{ width: '100%', maxWidth: 760 }}>
            <PaperSketch shotId={shot.id} ratio="16:9" clearSignal={clear} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="ppc-btn is-sm is-ghost" onClick={() => setClear(c => c + 1)}><Icon name="x" size={14} /> Clear</button>
            </div>
          </div>
        </div>

        <aside className="ppc-notes">
          <div className="ppc-notes__title"><Icon name="pencil" size={16} /><b>Shot notes</b></div>
          <div>
            <div className="ppc-flabel"><span>Action / Description</span></div>
            <textarea className="ppc-textarea" rows={4} value={action} onChange={e => setAction(e.target.value)} />
          </div>
          <div className="ppc-dialogue-wrap">
            <div className="ppc-flabel"><span>Dialogue</span></div>
            <textarea className="ppc-textarea" rows={3} value={dialogue} onChange={e => setDialogue(e.target.value)} placeholder="— no line —" />
          </div>
          <div className="ppc-row2">
            <div>
              <div className="ppc-flabel"><span>Camera / FX</span></div>
              <input className="ppc-input" defaultValue={shot.camera} />
            </div>
            <div>
              <div className="ppc-flabel"><span>Duration</span></div>
              <input className="ppc-input is-mono" defaultValue={shot.duration} />
            </div>
          </div>
          <div>
            <div className="ppc-flabel"><span>SFX / Sound</span></div>
            <input className="ppc-input is-mono" defaultValue={shot.sfx} />
          </div>
        </aside>
      </div>

      <div className="ppc-statusstrip">
        <div className="ppc-statusstrip__item"><span className="ppc-statusstrip__k">Status</span><StatusPill status={shot.status} /></div>
        <div className="ppc-statusstrip__item">
          <span className="ppc-statusstrip__k">Animate clip</span>
          <span className={`ppc-clipdot ${shot.baked ? 'has' : 'none'}`} />
          <span>{shot.baked ? 'Baked clip exists' : 'No baked clip yet'}</span>
        </div>
        <div className="ppc-statusstrip__item">
          <span className="ppc-statusstrip__k">Audio</span>
          <span className="ppc-clipdot none" />
          <span>{shot.dialogue ? 'Not voiced' : 'No line'}</span>
        </div>
        <span className="ppc-board__spacer" />
        <span className="ppc-id">{scene.id} · {shot.id}</span>
      </div>
    </div>
  )
}

export function CanvasShotDetail() {
  const { id = '', sceneId, shotId } = useParams()
  const [scenes, setScenes] = useState<CanvasScene[] | null>(null)
  const [error, setError] = useState('')

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
      <div className="ppc ppc-shotview">
        <div className="ppc-shotview__bar"><span className="ppc-board__title">Shot</span></div>
        <p style={{ padding: 22, color: 'var(--st-extracted)' }}>{error}</p>
      </div>
    )
  }
  if (!scenes) {
    return (
      <div className="ppc ppc-shotview">
        <div className="ppc-shotview__bar" />
        <div className="ppc-shotview__body"><div className="ppc-stage-wrap"><div className="anmt-skeleton" style={{ width: '100%', maxWidth: 760, aspectRatio: '16 / 9', borderRadius: 5 }} /></div></div>
      </div>
    )
  }

  const scene = sceneById(scenes, sceneId)
  const shot = shotById(scene, shotId)
  // key resets the editable field state when navigating between shots
  return <ShotDetailBody key={shot.id} projectId={id} scene={scene} shot={shot} />
}
