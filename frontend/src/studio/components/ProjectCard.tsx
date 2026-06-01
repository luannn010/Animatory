import { useNavigate } from 'react-router-dom'
import type { Project } from '../types'
import { phasePath } from '../phases'
import { PhaseBadge } from './PhaseBadge'

interface Props { project: Project }

export function ProjectCard({ project }: Props) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(phasePath(project.id, project.currentPhase))}
      className="text-left bg-canvas border border-hairline rounded-lg overflow-hidden hover:border-[#3772cf]/50 hover:shadow-card transition-all"
    >
      <div className="h-36 relative flex items-center justify-center" style={{ background: project.thumbnail }}>
        <span className="font-mono text-xs text-white/25">{project.id}_thumb.png</span>
        <div className="absolute top-2.5 right-2.5"><PhaseBadge phase={project.currentPhase} /></div>
      </div>
      <div className="p-4">
        <div className="font-semibold text-sm text-ink mb-1">{project.title}</div>
        <div className="text-xs text-stone">{project.sceneCount} scenes</div>
      </div>
    </button>
  )
}
