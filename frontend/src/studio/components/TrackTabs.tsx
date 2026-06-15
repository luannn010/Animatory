import { NavLink } from 'react-router-dom'
import type { Project, TrackId } from '../types'
import { preTrackPath } from '../phases'

const TABS: { id: TrackId | 'animatic' | 'checking'; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'audio', label: 'Audio' },
  { id: 'animatic', label: 'Animatic' },
  { id: 'checking', label: 'Checking' },
]

const DOT: Record<'idle' | 'active' | 'ready', string> = {
  idle: 'bg-hairline',
  active: 'bg-[#3772cf]',
  ready: 'bg-[#00b48a]',
}

interface Props { project: Project }

export function TrackTabs({ project }: Props) {
  return (
    <nav className="flex items-center gap-1 border-b border-hairline mb-6">
      {TABS.map(tab => {
        // Only the three parallel tracks carry a readiness dot; animatic/checking
        // are derived steps without their own TrackProgress.
        const track = (project.preTracks as Record<string, { status: 'idle' | 'active' | 'ready' }>)[tab.id]
        return (
          <NavLink
            key={tab.id}
            to={preTrackPath(project.id, tab.id)}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 h-10 text-sm border-b-2 rounded-t-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] ${
                isActive
                  ? 'border-[#3772cf] text-[#3772cf] font-medium'
                  : 'border-transparent text-steel hover:text-ink'
              }`
            }
          >
            {track && <span className={`w-1.5 h-1.5 rounded-full ${DOT[track.status]}`} aria-hidden="true" />}
            {tab.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
