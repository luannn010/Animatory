import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { VoiceCast, VoiceOption } from '../../types'
import { Icon, Pill, PlateThumb, TrackHeaderStrip } from '../../ui'

function VoiceCaster({ value, options, onChange, onPreview, playing }: {
  value: string | null; options: VoiceOption[]; onChange: (v: string) => void; onPreview: () => void; playing: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center">
        <Icon name="volume-2" size={15} className="pointer-events-none absolute left-2.5 text-stone" />
        <select
          value={value ?? ''} onChange={e => onChange(e.target.value)}
          className="h-9 w-52 appearance-none rounded-md border border-hairline bg-surface pl-8 pr-8 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
        >
          <option value="">Pick a voice…</option>
          {options.map(o => <option key={o.voiceId} value={o.voiceId}>{o.label}</option>)}
        </select>
        <Icon name="chevron-down" size={15} className="pointer-events-none absolute right-2.5 text-stone" />
      </div>
      <button
        onClick={onPreview} disabled={!value} aria-label="Preview voice"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border border-hairline transition-colors disabled:opacity-40 ${playing ? 'bg-[#3772cf] text-white' : 'bg-canvas text-steel hover:bg-surface'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]`}
      >
        {playing ? <span className="eq"><i /><i /><i /><i /></span> : <Icon name="play" size={14} />}
      </button>
    </div>
  )
}

function CastRow({ cast, options, onOpen }: { cast: VoiceCast; options: VoiceOption[]; onOpen: () => void }) {
  const [voiceId, setVoiceId] = useState(cast.voiceId)
  const [playing, setPlaying] = useState(false)
  const preview = () => { setPlaying(true); setTimeout(() => setPlaying(false), 1700) }
  const isCast = !!voiceId
  return (
    <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_auto_0.7fr_auto] items-center gap-4 border-b border-hairline px-3 py-3 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-10 shrink-0 rounded-md overflow-hidden"><PlateThumb id={cast.character} kind="character" ratio="1 / 1" /></div>
        <div className="flex flex-col">
          <b className="text-sm font-semibold text-ink">{cast.character}</b>
          <span className="text-xs text-stone">{cast.lineCount} lines</span>
        </div>
      </div>
      <Pill tone="neutral">{cast.dominantEmotion ?? '—'}</Pill>
      <span className="font-mono text-sm text-stone">{cast.lineCount} lines</span>
      <VoiceCaster value={voiceId} options={options} onChange={setVoiceId} onPreview={preview} playing={playing} />
      <Pill tone={isCast ? 'ready' : 'idle'} dot>{isCast ? 'Cast' : 'Uncast'}</Pill>
      <button onClick={onOpen} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-[#3772cf] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded">
        Open dialogue <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

export function AudioCastingView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [cast, setCast] = useState<VoiceCast[] | null>(null)
  const [options, setOptions] = useState<VoiceOption[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([studioApi.getVoiceCast(id), studioApi.getVoiceOptions()]).then(([c, o]) => {
      if (!alive) return
      setCast(c); setOptions(o)
    })
    return () => { alive = false }
  }, [id])

  if (!cast) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-lg anmt-skeleton" />)}
      </div>
    )
  }

  const castCount = cast.filter(c => c.voiceId).length
  const openDialogue = () => navigate(`/project/${id}/pre/audio/scene/${id}-sc6`)

  return (
    <div>
      <TrackHeaderStrip
        title="Audio casting" sub="Audition and assign a voice to every speaking character."
        done={castCount} total={cast.length} unit="cast"
      />
      <div className="rounded-lg border border-hairline bg-canvas">
        <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_auto_0.7fr_auto] gap-4 border-b border-hairline px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone">
          <span>Character</span><span>Emotion</span><span>Lines</span><span>Voice</span><span>Status</span><span />
        </div>
        {cast.map(c => <CastRow key={c.character} cast={c} options={options} onOpen={openDialogue} />)}
      </div>
    </div>
  )
}
