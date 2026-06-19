import { useEffect, useState } from 'react'
import { useParams, useLocation, Outlet } from 'react-router-dom'
import type { Project } from '../types'
import { studioApi } from '../api'
import { PhaseStepperBar } from '../components/PhaseStepperBar'
import { TrackTabs } from '../components/TrackTabs'

// Layout route for /project/:id/pre — phase stepper + track tabs + the active
// track's view via <Outlet/>. Sub-routes render the per-track pages.
//
// Flush modes drop the page chrome for immersive surfaces (both break out of the
// shell padding to the content region: right of the 208px nav, below the 60px
// header — couples to AppShell's nav/header size):
//   • 'full'  — the rig editor owns the viewport; even the tabs go (its own
//               header carries "← Design").
//   • 'track' — the Canvas board fills edge-to-edge but the track tabs stay, so
//               you can still switch Design / Canvas / Animatic / Checking.
export function PreShell() {
  const { id = '' } = useParams()
  const path = useLocation().pathname
  const flushMode: 'none' | 'track' | 'full' =
    /\/pre\/rig(\/|$)/.test(path) ? 'full'
      : /\/pre\/canvas\/[^/]+\/[^/]+\/studio(\/|$)/.test(path) ? 'full'
        : /\/pre\/canvas(\/|$)/.test(path) ? 'track'
          : 'none'
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => { studioApi.getProject(id).then(setProject) }, [id])

  async function rename(title: string) { setProject(await studioApi.updateProjectTitle(id, title)) }

  if (flushMode === 'full') return <Outlet />
  if (!project) return <div className="text-sm text-stone">Loading…</div>

  if (flushMode === 'track') {
    return (
      <div className="fixed left-52 top-[60px] right-0 bottom-0 z-10 flex flex-col bg-canvas">
        <div className="shrink-0 px-8 pt-4"><TrackTabs project={project} flush /></div>
        <div className="flex min-h-0 flex-1 flex-col"><Outlet /></div>
      </div>
    )
  }

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
