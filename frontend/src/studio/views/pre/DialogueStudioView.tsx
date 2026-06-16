import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { DialogueClip, Scene } from '../../types'
import { BackLink, Button, Icon, IconButton, Pill, type Tone } from '../../ui'

function Waveform({ seed, playing }: { seed: number; playing: boolean }) {
  const bars = useMemo(() => {
    const out: number[] = []; let x = seed * 9301 + 49297
    for (let i = 0; i < 48; i++) { x = (x * 9301 + 49297) % 233280; out.push(0.25 + (x / 233280) * 0.75) }
    return out
  }, [seed])
  return (
    <div className={`wave ${playing ? 'is-playing' : ''}`}>
      {bars.map((h, i) => <i key={i} style={{ height: `${h * 100}%`, animationDelay: `${i * 18}ms` }} />)}
    </div>
  )
}

const INTENSITY_TONE: Record<string, Tone> = { low: 'neutral', medium: 'active', high: 'warning' }

function Clip({ clip, index }: { clip: DialogueClip; index: number }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>(clip.status === 'pending' ? 'idle' : 'ready')
  const [approved, setApproved] = useState(clip.status === 'approved')
  const [playing, setPlaying] = useState(false)
  const generate = () => { setState('loading'); setTimeout(() => setState('ready'), 1500) }
  const play = () => { setPlaying(true); setTimeout(() => setPlaying(false), Math.round((clip.durationS ?? 1.5) * 1000)) }

  return (
    <div className="grid grid-cols-[110px_1fr_auto] items-start gap-4 rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex flex-col">
        <b className="text-sm font-semibold text-ink">{clip.character}</b>
      </div>
      <div className="min-w-0">
        <p className="text-sm text-ink">{clip.line}</p>
        <div className="mt-2 flex items-center gap-1.5">
          {clip.emotion && <Pill tone="neutral">{clip.emotion}</Pill>}
          {clip.intensity && <Pill tone={INTENSITY_TONE[clip.intensity] ?? 'neutral'}>{clip.intensity} intensity</Pill>}
        </div>
        {state === 'ready' && (
          <div className="mt-3 flex items-center gap-3">
            <button onClick={play} aria-label="Play line" className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${playing ? 'bg-[#3772cf] text-white' : 'bg-surface text-steel hover:text-ink'}`}>
              <Icon name={playing ? 'pause' : 'play'} size={14} />
            </button>
            <Waveform seed={index + 2} playing={playing} />
            <span className="font-mono text-xs text-stone shrink-0">{(clip.durationS ?? 0).toFixed(1)}s</span>
          </div>
        )}
        {state === 'loading' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-stone"><span className="anmt-spinner" /> Synthesizing voice…</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {state !== 'ready' ? (
          <Button size="sm" variant="primary" icon="sparkles" loading={state === 'loading'} onClick={generate}>Generate</Button>
        ) : (
          <>
            <button onClick={() => setApproved(a => !a)} className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${approved ? 'border-[#00b48a] bg-[#00b48a]/10 text-[#00b48a]' : 'border-hairline text-steel hover:bg-surface'}`}>
              <Icon name="check" size={14} /> {approved ? 'Approved' : 'Approve'}
            </button>
            <IconButton size="sm" icon="refresh" label="Regenerate" onClick={generate} />
          </>
        )}
      </div>
    </div>
  )
}

export function DialogueStudioView() {
  const { id = '', sceneId = '' } = useParams()
  const navigate = useNavigate()
  const [clips, setClips] = useState<DialogueClip[] | null>(null)
  const [scene, setScene] = useState<Scene | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([studioApi.getDialogueClips(id, sceneId), studioApi.getScenes(id)]).then(([c, scenes]) => {
      if (!alive) return
      setClips(c); setScene(scenes.find(s => s.id === sceneId) ?? null)
    })
    return () => { alive = false }
  }, [id, sceneId])

  const total = (clips ?? []).reduce((s, c) => s + (c.durationS ?? 0), 0)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4 border-b border-hairline pb-5">
        <BackLink onClick={() => navigate(`/project/${id}/pre/audio`)}>Casting</BackLink>
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="font-mono text-sm font-semibold text-ink">{scene ? `SC-${String(scene.number).padStart(3, '0')}` : sceneId}</span>
          <span className="truncate text-sm text-stone">{scene?.description}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-stone">Scene total <b className="font-mono text-ink">{total.toFixed(1)}s</b></span>
          <Button size="sm" variant="secondary" icon="download">Export X-sheet</Button>
          <Button size="sm" variant="primary" icon="sparkles">Generate all</Button>
        </div>
      </div>

      {!clips ? (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-lg anmt-skeleton" />)}
        </div>
      ) : clips.length === 0 ? (
        <p className="text-sm text-stone">No dialogue in this scene.</p>
      ) : (
        <div className="space-y-3">
          {clips.map((c, i) => <Clip key={c.id} clip={c} index={i} />)}
        </div>
      )}
    </div>
  )
}
