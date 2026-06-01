import type { Scene } from '../types'

interface Props { scene: Scene }

export function SceneCard({ scene }: Props) {
  return (
    <div className="bg-canvas border border-hairline rounded-md p-4">
      <div className="font-mono text-[11px] uppercase tracking-wide text-stone mb-1.5">
        Scene {String(scene.number).padStart(2, '0')}
      </div>
      <div className="text-sm font-medium text-ink mb-2 leading-snug">{scene.description}</div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline">
          {scene.location}
        </span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline">
          {scene.characters.join(', ')}
        </span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline">
          {scene.duration}
        </span>
      </div>
    </div>
  )
}
