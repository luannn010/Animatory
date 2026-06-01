import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Project, VendorScene } from '../types'
import { studioApi } from '../api'
import { phasePath } from '../phases'
import { PhaseStepperBar } from '../components/PhaseStepperBar'
import { PipelineRow } from '../components/PipelineRow'

export function VendorView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [scenes, setScenes] = useState<VendorScene[]>([])

  useEffect(() => {
    studioApi.getProject(id).then(setProject)
    studioApi.getVendorScenes(id).then(setScenes)
  }, [id])

  if (!project) return <div className="text-sm text-stone">Loading…</div>

  const approved = scenes.filter(s => s.approved).length
  const total = project.sceneCount || scenes.length
  const pct = total ? Math.round((approved / total) * 100) : 0

  async function rename(title: string) { setProject(await studioApi.updateProjectTitle(id, title)) }
  async function sendToPost() {
    await studioApi.advancePhase(id, 'post')
    navigate(phasePath(id, 'post'))
  }

  return (
    <div className="max-w-5xl">
      <PhaseStepperBar project={project} current="vendor" onRename={rename} />

      <div className="flex items-end justify-between mb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Phase 3</p>
          <h1 className="text-xl font-semibold text-ink tracking-tight">Vendor Studio</h1>
          <p className="text-sm text-steel mt-1">Per-scene pipeline — Build → Set Up → Block → Animate → Take 1 → Editor</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-semibold text-ink tabular-nums">{approved} / {total}</div>
            <div className="text-xs text-stone">scenes complete</div>
          </div>
          <div className="w-24 h-1 bg-hairline rounded-full overflow-hidden">
            <div className="h-full bg-[#3772cf] rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {scenes.map(s => <PipelineRow key={s.id} scene={s} />)}
      </div>

      <div className="flex justify-end border-t border-hairline mt-6 pt-5">
        <button
          onClick={sendToPost}
          className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab]"
        >
          Send to Post-production →
        </button>
      </div>
    </div>
  )
}
