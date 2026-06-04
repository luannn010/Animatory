// frontend/src/components/refine/SceneReadView.tsx
import type { PipelineScene } from '../../api/pipeline'

/** Read-only render of a scene's body: action, tag chips, dialogue rows,
 *  narration list. Shared by the scene card, the re-parse proposal block, and
 *  the focus panel so all three render a scene identically. */
export function SceneReadView({ scene }: { scene: PipelineScene }) {
  const tags = [scene.location, scene.characters.join(', '), scene.mood].filter(Boolean)
  return (
    <div>
      {scene.action && (
        <p className="text-sm font-medium text-ink leading-snug mb-2.5">{scene.action}</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 last:mb-0">
          {tags.map((t, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[11px] bg-surface text-steel border border-hairline">
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
