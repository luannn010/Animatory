import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../types'
import { studioApi } from '../api'
import { phasePath } from '../phases'
import { ProjectCard } from '../components/ProjectCard'

export function DashboardView() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    studioApi.listProjects().then(setProjects).finally(() => setLoading(false))
  }, [])

  async function newProject() {
    const created = await studioApi.createProject()
    navigate(phasePath(created.id, 'script'))
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Studio</p>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Projects</h1>
          <p className="text-sm text-steel mt-1">{projects.length} active projects across all phases</p>
        </div>
        <button
          onClick={newProject}
          className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] transition-colors"
        >
          + New Project
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-56 bg-hairline rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {projects.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  )
}
