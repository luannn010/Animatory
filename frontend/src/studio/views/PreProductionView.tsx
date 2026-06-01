import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Project, Scene, Asset } from '../types'
import { studioApi } from '../api'
import { phasePath } from '../phases'
import { PhaseStepperBar } from '../components/PhaseStepperBar'
import { AssetCard } from '../components/AssetCard'

type Track = 'design' | 'storyboard' | 'casting'

const TRACKS: { key: Track; icon: string; name: string; status: string; pct: number; color: string }[] = [
  { key: 'design',     icon: '🎨', name: 'Design',     status: '8 of 12 assets done', pct: 66, color: 'bg-[#3772cf]' },
  { key: 'storyboard', icon: '🖼', name: 'Storyboard', status: '4 of 18 scenes done', pct: 22, color: 'bg-[#c37d0d]' },
  { key: 'casting',    icon: '🎙', name: 'Casting',    status: 'All 4 characters cast', pct: 100, color: 'bg-[#00b48a]' },
]

export function PreProductionView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [tab, setTab] = useState<Track>('design')

  useEffect(() => {
    studioApi.getProject(id).then(setProject)
    studioApi.getAssets(id).then(setAssets)
    studioApi.getScenes(id).then(setScenes)
  }, [id])

  if (!project) return <div className="text-sm text-stone">Loading…</div>

  async function rename(title: string) { setProject(await studioApi.updateProjectTitle(id, title)) }
  async function sendToVendor() {
    await studioApi.advancePhase(id, 'vendor')
    navigate(phasePath(id, 'vendor'))
  }

  return (
    <div className="max-w-5xl">
      <PhaseStepperBar project={project} current="pre" onRename={rename} />

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Phase 2</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">Pre-production Hub</h1>
      <p className="text-sm text-steel mt-1 mb-6">Three parallel tracks. All must complete before sending to vendor studio.</p>

      <div className="grid grid-cols-3 gap-3.5 mb-7">
        {TRACKS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-left bg-canvas border rounded-lg p-5 transition-all ${
              tab === t.key ? 'border-[#3772cf] bg-[#3772cf]/[0.04]' : 'border-hairline hover:border-[#3772cf]/40'
            }`}
          >
            <div className="text-xl mb-2.5">{t.icon}</div>
            <div className="font-semibold text-ink mb-1">{t.name}</div>
            <div className="text-xs text-stone mb-3">{t.status}</div>
            <div className="h-1 bg-hairline rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${t.color}`} style={{ width: `${t.pct}%` }} />
            </div>
          </button>
        ))}
      </div>

      {tab === 'design' && (
        <div>
          <h2 className="text-base font-semibold text-ink mb-1">Design Assets</h2>
          <p className="text-sm text-stone mb-4">Characters, props, and backgrounds</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
            {assets.map(a => <AssetCard key={a.id} asset={a} />)}
          </div>
        </div>
      )}

      {tab === 'storyboard' && (
        <div>
          <h2 className="text-base font-semibold text-ink mb-1">Storyboard</h2>
          <p className="text-sm text-stone mb-4">Scene clips — expand each to see shot list</p>
          <div className="flex flex-col gap-2">
            {scenes.map(s => (
              <details key={s.id} className="bg-canvas border border-hairline rounded-md px-4 py-3">
                <summary className="cursor-pointer flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">
                    <span className="font-mono text-[11px] text-stone mr-2">SC-{String(s.number).padStart(2, '0')}</span>
                    {s.description}
                  </span>
                </summary>
                <ul className="mt-3 pl-4 text-sm text-steel list-disc space-y-1">
                  <li>Shot 1 — establishing, {s.location}</li>
                  <li>Shot 2 — medium on {s.characters[0] ?? 'character'}</li>
                  <li>Shot 3 — reaction / cut</li>
                </ul>
              </details>
            ))}
          </div>
        </div>
      )}

      {tab === 'casting' && (
        <div>
          <h2 className="text-base font-semibold text-ink mb-1">Voice Casting</h2>
          <p className="text-sm text-stone mb-4">Characters and their assigned voices</p>
          <div className="flex flex-col gap-2">
            {['Hana', 'Riku'].map((name, i) => (
              <div key={name} className="bg-canvas border border-hairline rounded-md px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[11px] text-stone">Character</div>
                  <div className="text-sm font-medium text-ink">{name}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] bg-surface text-steel border border-hairline px-2 py-1 rounded-xs">
                    🎙 Voice {String.fromCharCode(65 + i * 2)} · TTS-Neural
                  </span>
                  <button className="px-3 py-1 rounded-sm border border-hairline text-steel text-xs hover:bg-surface">▶ Preview</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center border-t border-hairline mt-6 pt-5">
        <span className="text-xs text-stone">Casting ✓ · Design 66% · Storyboard 22% — complete all tracks to unlock</span>
        <button
          onClick={sendToVendor}
          className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab]"
        >
          Send to Vendor Studio →
        </button>
      </div>
    </div>
  )
}
