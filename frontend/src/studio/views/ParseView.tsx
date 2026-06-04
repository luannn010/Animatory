import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Project } from '../types'
import { studioApi } from '../api'
import { phasePath } from '../phases'
import { PhaseStepperBar } from '../components/PhaseStepperBar'
import { UploadTranscript } from '../../components/UploadTranscript'
import { ParseChunks } from '../../components/ParseChunks'
import { listEpisodes, type EpisodeStatus } from '../../api/pipeline'

export function ParseView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [episodes, setEpisodes] = useState<EpisodeStatus[]>([])
  // Bumped after a chunk run so the cards below re-fetch.
  const [reload, setReload] = useState(0)

  useEffect(() => {
    studioApi.getProject(id).then(setProject)
  }, [id])

  // This project's transcripts: episodes namespaced as `${id}__<slug>` (plus a
  // legacy bare `${id}` episode from before transcripts were named).
  const loadEpisodes = useCallback(async () => {
    const all = await listEpisodes()
    setEpisodes(all.filter(e => e.episode_id === id || e.episode_id.startsWith(`${id}__`)))
  }, [id])

  useEffect(() => {
    loadEpisodes()
  }, [loadEpisodes, reload])

  if (!project) return <div className="text-sm text-stone">Loading…</div>

  async function rename(title: string) {
    setProject(await studioApi.updateProjectTitle(id, title))
  }
  async function cont() {
    await studioApi.advancePhase(id, 'pre')
    navigate(phasePath(id, 'pre'))
  }

  return (
    <div className="max-w-5xl">
      <PhaseStepperBar project={project} current="parse" onRename={rename} />

      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3772cf] font-mono mb-0.5">Phase 1</p>
      <h1 className="text-xl font-semibold text-ink tracking-tight">Script Parsing</h1>
      <p className="text-sm text-steel mt-1 mb-6">
        Upload a transcript, chunk it, then parse each chunk into scenes. Each transcript gets its own card.
      </p>

      <UploadTranscript projectId={id} onChunked={() => setReload(r => r + 1)} />

      {episodes.length === 0 ? (
        <p className="text-xs text-stone mb-6">No transcripts yet — upload one above to get started.</p>
      ) : (
        episodes.map(ep => (
          <ParseChunks
            key={ep.episode_id}
            episodeId={ep.episode_id}
            title={ep.display_name || ep.episode_id.replace(`${id}__`, '').replace(/-/g, ' ')}
            reloadKey={reload}
          />
        ))
      )}

      <div className="flex justify-end border-t border-hairline pt-5 mt-2">
        <button
          onClick={cont}
          className="px-4 py-2 rounded-md bg-[#3772cf] text-white text-sm font-medium hover:bg-[#2c5cab] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] transition-colors"
        >
          Continue to Pre-production →
        </button>
      </div>
    </div>
  )
}
