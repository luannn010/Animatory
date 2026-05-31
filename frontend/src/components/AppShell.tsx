import { NavLink } from 'react-router-dom'
import { USE_MOCK } from '../config'

const NAV = [
  { to: '/agents',  label: 'Agents',  icon: '⬡' },
  { to: '/runs',    label: 'Runs',    icon: '▶' },
  { to: '/metrics', label: 'Metrics', icon: '◈' },
]

interface Props { children: React.ReactNode }

export function AppShell({ children }: Props) {
  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <header
        className="px-8 py-4 flex items-center justify-between shrink-0"
        style={{ background: 'linear-gradient(135deg, #1a3d4a 0%, #2d5a4f 100%)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[#00d4a4] font-bold text-lg tracking-tight">Animatory</span>
          <span className="text-[#b3b3b3] text-sm font-mono">/ studio</span>
        </div>
        <div className="flex items-center gap-2">
          {USE_MOCK && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#c37d0d]/20 text-[#c37d0d] border border-[#c37d0d]/30">
              mock
            </span>
          )}
          <span className="text-[#b3b3b3] text-xs font-mono">agent pipeline</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-52 shrink-0 border-r border-hairline bg-canvas py-6 px-2 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel px-4 pb-2">
            Studio
          </p>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-surface text-ink font-medium' : 'text-steel'
                }`
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-auto p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
