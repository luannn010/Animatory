import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { Animatic, AnimaticEntry } from '../../types'
import { Button, Icon, PlateThumb } from '../../ui'

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export function AnimaticView() {
  const { id = '' } = useParams()
  const [animatic, setAnimatic] = useState<Animatic | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [final, setFinal] = useState(false)
  const raf = useRef<number>(0)

  useEffect(() => { studioApi.getAnimatic(id).then(setAnimatic) }, [id])

  const total = animatic?.totalDurationS ?? 0
  useEffect(() => {
    if (!playing || !total) return
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = (now - prev) / 1000; prev = now
      setT(x => { const n = x + dt; if (n >= total) { setPlaying(false); return total } return n })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, total])

  if (!animatic) return <div className="h-96 rounded-xl anmt-skeleton" aria-hidden="true" />

  const clips = animatic.entries
  let acc = 0, current: AnimaticEntry = clips[0]
  for (const c of clips) { if (t >= acc && t < acc + c.durationS) { current = c; break } acc += c.durationS }
  const playheadPct = total ? (t / total) * 100 : 0
  const audioTimed = clips.filter(c => c.audioClipId).length

  const scrub = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setT(Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)))
  }
  const startOf = (entry: AnimaticEntry) => { let a = 0; for (const x of clips) { if (x === entry) break; a += x.durationS } return a }

  return (
    <div className="flex flex-col gap-6 rounded-xl bg-stage-dark p-6 text-on-dark">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-on-dark-muted">
          <span><b className="font-mono text-on-dark">{clips.length}</b>/{clips.length} panels</span>
          <span className="text-on-dark-muted/50">·</span>
          <span><b className="font-mono text-on-dark">{audioTimed}</b>/{clips.length} audio timed</span>
        </div>
        <Button variant={final ? 'secondary' : 'primary'} icon={final ? 'check' : 'film'} onClick={() => setFinal(true)}>
          {final ? 'Animatic final' : 'Mark animatic final'}
        </Button>
      </div>

      <div className="flex justify-center">
        <div className="relative w-full max-w-3xl overflow-hidden rounded-lg">
          <PlateThumb id={`${current?.panelId}-frame`} kind="location" ratio="16 / 9" />
          <span className="absolute left-3 top-3 rounded bg-black/40 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">{current?.sceneId}</span>
        </div>
      </div>

      {/* transport */}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4">
        <button onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#3772cf] text-white transition-colors hover:bg-[#2c5cab]">
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <span className="font-mono text-sm text-on-dark-muted shrink-0">{fmt(t)}</span>
        <div onClick={scrub} className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/15">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[#3772cf]" style={{ width: `${playheadPct}%` }} />
          <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(55,114,207,0.4)]" style={{ left: `${playheadPct}%` }} />
        </div>
        <span className="font-mono text-sm text-on-dark-muted/60 shrink-0">{fmt(total)}</span>
      </div>

      {/* timeline */}
      <div className="relative flex gap-1 overflow-hidden rounded-lg bg-white/5 p-3">
        {clips.map(c => {
          const w = total ? (c.durationS / total) * 100 : 0
          const isCur = c === current
          return (
            <button key={c.panelId} onClick={() => setT(startOf(c))} style={{ width: `${w}%` }}
              className={`flex min-w-0 shrink-0 flex-col gap-1 text-left transition-opacity ${isCur ? 'opacity-100' : 'opacity-70 hover:opacity-90'}`}>
              <div className={`overflow-hidden rounded-sm ${isCur ? 'outline outline-1 outline-[#5a8ad8]' : ''}`}><PlateThumb id={`${c.panelId}-tl`} kind="location" ratio="16 / 9" /></div>
              <div className={`flex h-3.5 items-center rounded-[3px] px-1 ${c.audioClipId ? 'bg-[#3772cf]/30' : 'bg-white/5'}`}>
                {c.audioClipId
                  ? <span className="h-1.5 flex-1 rounded-sm" style={{ background: 'repeating-linear-gradient(90deg,#7ea3dd,#7ea3dd 2px,transparent 2px,transparent 4px)', opacity: 0.7 }} />
                  : <span className="text-[9px] tracking-wide text-on-dark-muted/50">no audio</span>}
              </div>
              <span className="truncate font-mono text-[9px] text-on-dark-muted/70">{c.sceneId}</span>
            </button>
          )
        })}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" style={{ left: `${playheadPct}%` }} />
      </div>
    </div>
  )
}
