import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import type { Scene, StoryboardPanel } from '../../types'
import { BackLink, Button, Icon, IconButton, PlateThumb } from '../../ui'

const RATIOS = ['16:9', '9:16', '4:3', '1:1'] as const
type Ratio = typeof RATIOS[number]
const RATIO_CSS: Record<Ratio, string> = { '16:9': '16 / 9', '9:16': '9 / 16', '4:3': '4 / 3', '1:1': '1 / 1' }

// Lightweight click-and-drag sketch surface on a <canvas>.
function SketchFrame({ clearSignal }: { clearSignal: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const c = ref.current; if (!c) return
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setDirty(false)
  }, [clearSignal])

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = ref.current!; const r = c.getBoundingClientRect()
    const t = 'touches' in e ? e.touches[0] : e
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) }
  }
  const start = (e: React.MouseEvent | React.TouchEvent) => { drawing.current = true; last.current = pos(e); setDirty(true) }
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    const ctx = ref.current!.getContext('2d')!; const p = pos(e)
    ctx.strokeStyle = '#2c323b'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
  }
  const end = () => { drawing.current = false }

  return (
    <div className="absolute inset-0">
      <canvas
        ref={ref} width={480} height={270} className="sketch__canvas"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      {!dirty && <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-stone">Click &amp; drag to sketch — or generate</span>}
    </div>
  )
}

const SRC_TONE: Record<string, string> = {
  drawn: 'bg-[#3772cf]/10 text-[#3772cf]', generated: 'bg-[#00b48a]/10 text-[#00b48a]', empty: 'bg-surface text-stone',
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-stone">{label}</span>
      <input defaultValue={value} className={`h-[30px] w-full rounded-md border border-hairline bg-surface px-2 text-sm text-ink ${mono ? 'font-mono' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]`} />
    </label>
  )
}

function PanelCard({ panel, index, clearSignal, ratio }: { panel: StoryboardPanel; index: number; clearSignal: number; ratio: Ratio }) {
  const [source, setSource] = useState(panel.source)
  const [gen, setGen] = useState(false)
  const generate = () => { setGen(true); setTimeout(() => { setGen(false); setSource('generated') }, 1500) }
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
      <div className="relative bg-surface" style={{ aspectRatio: RATIO_CSS[ratio] }}>
        {gen ? (
          <div className="absolute inset-0 grid place-items-center gap-2 text-sm text-stone"><span className="anmt-spinner" /> Generating panel…</div>
        ) : source === 'generated' ? (
          <PlateThumb id={panel.id} kind="location" ratio={RATIO_CSS[ratio]} />
        ) : (
          <SketchFrame clearSignal={clearSignal} />
        )}
        <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${SRC_TONE[source]}`}>{source}</span>
        <span className="absolute left-2 top-2 font-mono text-[11px] text-white/90 drop-shadow">{String(index + 1).padStart(2, '0')}</span>
        {source !== 'generated' && !gen && (
          <button onClick={generate} className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-[#3772cf] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#2c5cab] transition-colors">
            <Icon name="sparkles" size={13} /> Generate panel
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex gap-2">
          <Field label="Shot" value={panel.shotType} />
          <Field label="Duration" value={panel.durationS != null ? `${panel.durationS}s` : '—'} mono />
        </div>
        <Field label="Action" value={panel.action} />
        <div className="flex gap-2">
          <Field label="Camera / FX" value={panel.camera} />
          <Field label="SFX" value={panel.sfx || '—'} />
        </div>
      </div>
    </div>
  )
}

export function PanelBoardView() {
  const { id = '', sceneId = '' } = useParams()
  const navigate = useNavigate()
  const [panels, setPanels] = useState<StoryboardPanel[] | null>(null)
  const [scene, setScene] = useState<Scene | null>(null)
  const [ratio, setRatio] = useState<Ratio>('16:9')
  const [clearSignal, setClearSignal] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([studioApi.getStoryboardPanels(id, sceneId), studioApi.getScenes(id)]).then(([p, scenes]) => {
      if (!alive) return
      setPanels(p); setScene(scenes.find(s => s.id === sceneId) ?? null)
    })
    return () => { alive = false }
  }, [id, sceneId])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-hairline pb-4">
        <BackLink onClick={() => navigate(`/project/${id}/pre/storyboard`)}>Storyboard</BackLink>
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="font-mono text-sm font-semibold text-ink">{scene ? `SC-${String(scene.number).padStart(3, '0')}` : sceneId}</span>
          <span className="truncate text-sm text-stone">{scene?.description}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" icon="plus">Add panel</Button>
          <div className="flex items-center gap-0.5 rounded-md border border-hairline p-0.5">
            {RATIOS.map(r => (
              <button key={r} onClick={() => setRatio(r)}
                className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${ratio === r ? 'bg-[#3772cf] text-white' : 'text-steel hover:bg-surface'}`}>{r}</button>
            ))}
          </div>
          <Button size="sm" variant="ghost" icon="x" onClick={() => setClearSignal(s => s + 1)}>Clear drawings</Button>
          <IconButton size="md" icon="printer" label="Print / export" />
        </div>
      </div>

      <div className="rounded-lg bg-paper p-4">
        {!panels ? (
          <div className="grid grid-cols-2 gap-4" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 rounded-lg anmt-skeleton" />)}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {panels.map((p, i) => <PanelCard key={p.id} panel={p} index={i} clearSignal={clearSignal} ratio={ratio} />)}
            <button className="grid min-h-[200px] place-items-center gap-2 rounded-lg border border-dashed border-hairline text-stone hover:text-[#3772cf] hover:border-[#3772cf]/50 transition-colors">
              <Icon name="plus" size={22} /><span className="text-sm">Add panel</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
