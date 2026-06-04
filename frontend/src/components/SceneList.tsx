// frontend/src/components/SceneList.tsx
import type { PipelineScene } from '../api/pipeline'

interface Props {
  scenes: PipelineScene[]
}

/**
 * Renders a parsed chunk's shot list as designed scene cards — the rendered
 * alternative to the raw _scenes.json. Action is the headline; location,
 * characters, shot type and mood are tags; dialogue lines follow.
 */
export function SceneList({ scenes }: Props) {
  if (scenes.length === 0) {
    return (
      <div className="text-xs text-stone py-3">
        No scenes were extracted from this chunk.
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {scenes.map(scene => (
        <SceneCardItem key={scene.scene_id} scene={scene} />
      ))}
    </div>
  )
}

function SceneCardItem({ scene }: { scene: PipelineScene }) {
  const tags = [scene.location, scene.characters.join(', '), scene.mood].filter(Boolean)

  return (
    <div className="bg-canvas border border-hairline rounded-md p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-stone">
          {sceneLabel(scene.scene_id)}
        </span>
        {scene.shot_type && (
          <span className="font-mono text-[11px] uppercase tracking-wide text-[#3772cf] shrink-0">
            {scene.shot_type}
          </span>
        )}
      </div>

      {scene.action && (
        <p className="text-sm font-medium text-ink leading-snug mb-2.5">{scene.action}</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 last:mb-0">
          {tags.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {scene.dialogue.length > 0 && (
        <dl className="space-y-1 border-t border-hairline pt-2.5">
          {scene.dialogue.map((d, i) => (
            <div key={i} className="flex gap-2 text-xs leading-snug">
              <dt className="font-medium text-steel shrink-0">{d.character}</dt>
              <dd className="text-ink">
                {d.line}
                {d.emotion && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-xs text-[10px] bg-surface text-steel border border-hairline align-middle">
                    {d.emotion}{d.intensity ? ` · ${d.intensity}` : ''}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {scene.narration && scene.narration.length > 0 && (
        <div className="mt-2.5 border-t border-hairline pt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone mb-1">Narration</div>
          <ul className="space-y-1 text-xs text-steel italic leading-snug">
            {scene.narration.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

/** "C001_S01" → "Scene 01"; falls back to the raw id if it doesn't match. */
function sceneLabel(sceneId: string): string {
  const m = sceneId.match(/_S(\d+)$/)
  return m ? `Scene ${m[1]}` : sceneId
}
