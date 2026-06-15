import { useEffect, useState } from 'react'
import { useParams, Outlet } from 'react-router-dom'
import type { Project } from '../types'
import { studioApi } from '../api'
import { PhaseStepperBar } from '../components/PhaseStepperBar'
import { TrackTabs } from '../components/TrackTabs'

// Layout route for /project/:id/pre — phase stepper + track tabs + the active
// track's view via <Outlet/>. Sub-routes render the per-track pages.
export function PreShell() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => { studioApi.getProject(id).then(setProject) }, [id])

  if (!project) return <div className="text-sm text-stone">Loading…</div>

  async function rename(title: string) { setProject(await studioApi.updateProjectTitle(id, title)) }

  return (
    <div className="max-w-5xl">
      <PhaseStepperBar project={project} current="pre" onRename={rename} />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Phase 2</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight mb-5">Pre-production</h1>
      <TrackTabs project={project} />
      <Outlet />
    </div>
  )
}
