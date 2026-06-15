// frontend/src/components/refine/VoiceProfilePanel.tsx
import { useEffect, useState } from 'react'
import { getVoiceProfiles, type VoiceProfile } from '../../api/pipeline'

interface Props {
  episodeId: string
  refreshKey?: number
  // When non-null, the panel renders streamed profiles (live parse) instead of
  // fetching; an empty array means "streaming, none yet" → skeleton.
  liveProfiles?: VoiceProfile[] | null
}

export function VoiceProfilePanel({ episodeId, refreshKey = 0, liveProfiles = null }: Props) {
  const streaming = liveProfiles !== null
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (streaming) return  // streamed data drives the panel
    let alive = true
    setLoading(true); setError('')
    getVoiceProfiles(episodeId)
      .then(r => { if (alive) setProfiles(r.profiles) })
      .catch(e => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [episodeId, refreshKey, streaming])

  const shown = streaming ? (liveProfiles as VoiceProfile[]) : profiles
  const isLoading = streaming ? shown.length === 0 : loading

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">Character voices</h3>
      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-surface animate-pulse" />
          ))}
        </div>
      ) : !streaming && error ? (
        <p className="text-xs text-brand-error">{error}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-stone">No dialogue parsed yet — voice profiles appear once chapters are parsed.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map(p => (
            <li key={p.character} className="border-t border-hairline pt-2.5 first:border-t-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-ink">{p.character}</span>
                <span className="text-[10px] text-stone">
                  {p.line_count} line{p.line_count === 1 ? '' : 's'}
                  {p.dominant_emotion ? ` · mostly ${p.dominant_emotion}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(p.emotions).sort((a, b) => b[1] - a[1]).map(([em, n]) => (
                  <span key={em} className="inline-flex items-center px-1.5 py-0.5 rounded-xs text-[10px] bg-surface text-steel border border-hairline">
                    {em} · {n}
                  </span>
                ))}
                {Object.keys(p.emotions).length === 0 && (
                  <span className="text-[10px] text-stone">no emotion tags</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
