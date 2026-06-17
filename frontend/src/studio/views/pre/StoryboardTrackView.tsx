import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { Scene, StoryboardPanel } from '../../types'
import { Icon, Pill, PlateThumb, TrackHeaderStrip } from '../../ui'

const sceneRef = (n: number) => `SC-${String(n).padStart(3, '0')}`

function SceneRow({ scene, panels, onOpen }: { scene: Scene; panels: StoryboardPanel[]; onOpen: () => void }) {
  const boarded = panels.length > 0
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-lg border border-hairline bg-canvas px-4 py-3 text-left transition-colors hover:border-[#3772cf]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] group"
    >
      <span className="font-mono text-xs font-semibold text-ink w-16 shrink-0">{sceneRef(scene.number)}</span>
      <Pill tone="neutral">{scene.location.split(' - ')[0] || 'INT'}</Pill>
      <span className="flex-1 truncate text-sm text-steel">{scene.description}</span>
      <div className="flex items-center gap-1">
        {boarded
          ? panels.slice(0, 5).map(p => <div key={p.id} className="w-[46px] rounded-sm overflow-hidden"><PlateThumb id={p.id} kind="location" ratio="16 / 9" /></div>)
          : <span className="text-xs italic text-stone">No panels yet</span>}
      </div>
      <Pill tone={boarded ? 'ready' : 'idle'} dot>{panels.length} {panels.length === 1 ? 'panel' : 'panels'}</Pill>
      <Icon name="chevron-right" size={18} className="text-stone group-hover:text-[#3772cf] transition-colors" />
    </button>
  )
}

export function StoryboardTrackView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  const [panels, setPanels] = useState<StoryboardPanel[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([studioApi.getScenes(id), studioApi.getStoryboardPanels(id)]).then(([s, p]) => {
      if (!alive) return
      setScenes(s); setPanels(p)
    })
    return () => { alive = false }
  }, [id])

  if (!scenes) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-lg anmt-skeleton" />)}
      </div>
    )
  }

  const panelsFor = (sceneId: string) => panels.filter(p => p.sceneId === sceneId)
  const boarded = scenes.filter(s => panelsFor(s.id).length > 0).length

  return (
    <div>
      <TrackHeaderStrip
        title="Storyboard" sub="Scene-by-scene boarding progress, parsed from the script."
        done={boarded} total={scenes.length} unit="scenes boarded"
      />
      {scenes.length === 0 ? (
        <p className="text-sm text-stone">No scenes parsed yet.</p>
      ) : (
        <div className="space-y-2">
          {scenes.map(s => (
            <SceneRow key={s.id} scene={s} panels={panelsFor(s.id)} onOpen={() => navigate(`/project/${id}/pre/storyboard/scene/${s.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}
