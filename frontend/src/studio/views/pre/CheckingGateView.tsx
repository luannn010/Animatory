import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../../api'
import { loadDesignAssets } from '../../entityAssets'
import type { DesignAsset, Scene, StoryboardPanel, VoiceCast } from '../../types'
import { Button, Card, Icon, Pill } from '../../ui'

function Ring({ pct, ready }: { pct: number; ready: boolean }) {
  const r = 22, c = 2 * Math.PI * r, off = c * (1 - pct / 100)
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="#e5e5e5" strokeWidth="5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={ready ? '#00b48a' : '#3772cf'} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 28 28)" />
      <text x="28" y="32" textAnchor="middle" className="fill-ink text-[13px] font-semibold font-mono">{pct}%</text>
    </svg>
  )
}

interface GateItem { label: string; val: string; done: boolean }

function GateCard({ title, pct, items }: { title: string; pct: number; items: GateItem[] }) {
  const ready = pct === 100
  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-4">
        <Ring pct={pct} ready={ready} />
        <div>
          <h3 className="mb-1.5 text-base font-semibold text-ink">{title}</h3>
          <Pill tone={ready ? 'ready' : 'active'} dot>{ready ? 'Met' : 'In progress'}</Pill>
        </div>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {items.map(it => (
          <li key={it.label} className={`flex items-center gap-2 ${it.done ? 'text-ink' : 'text-steel'}`}>
            <span className={it.done ? 'text-[#00b48a]' : 'text-stone'}><Icon name={it.done ? 'check' : 'clock'} size={13} /></span>
            {it.label}
            <span className="ml-auto font-mono text-xs text-stone">{it.val}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function CheckingGateView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [assets, setAssets] = useState<DesignAsset[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [panels, setPanels] = useState<StoryboardPanel[]>([])
  const [cast, setCast] = useState<VoiceCast[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      loadDesignAssets(id), studioApi.getScenes(id), studioApi.getStoryboardPanels(id), studioApi.getVoiceCast(id),
    ]).then(([a, s, p, c]) => {
      if (!alive) return
      setAssets(a); setScenes(s); setPanels(p); setCast(c); setLoaded(true)
    })
    return () => { alive = false }
  }, [id])

  if (!loaded) return <div className="h-96 rounded-xl anmt-skeleton" aria-hidden="true" />

  const dLocked = assets.filter(a => a.stage === 'locked').length
  const boarded = scenes.filter(s => panels.some(p => p.sceneId === s.id)).length
  const castN = cast.filter(c => c.voiceId).length
  const designPct = assets.length ? Math.round((dLocked / assets.length) * 100) : 0
  const sbPct = scenes.length ? Math.round((boarded / scenes.length) * 100) : 0
  const audioPct = cast.length ? Math.round((castN / cast.length) * 100) : 0
  const animaticFinal = false
  const ready = designPct >= 100 && sbPct >= 100 && audioPct >= 100 && animaticFinal

  const blockers: string[] = []
  if (designPct < 100) blockers.push(`${assets.length - dLocked} designs still unlocked`)
  if (sbPct < 100) blockers.push(`${scenes.length - boarded} scenes not boarded`)
  if (audioPct < 100) blockers.push(`${cast.length - castN} characters uncast`)
  if (!animaticFinal) blockers.push('animatic not marked final')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GateCard title="Design" pct={designPct} items={[
          { label: 'Designs locked', val: `${dLocked}/${assets.length}`, done: designPct === 100 },
          { label: 'Characters', val: `${assets.filter(a => a.kind === 'character' && a.stage === 'locked').length}/${assets.filter(a => a.kind === 'character').length}`, done: false },
          { label: 'Locations', val: `${assets.filter(a => a.kind === 'location' && a.stage === 'locked').length}/${assets.filter(a => a.kind === 'location').length}`, done: false },
        ]} />
        <GateCard title="Storyboard" pct={sbPct} items={[
          { label: 'Scenes boarded', val: `${boarded}/${scenes.length}`, done: sbPct === 100 },
          { label: 'Panels drawn', val: `${panels.length}`, done: false },
        ]} />
        <GateCard title="Audio" pct={audioPct} items={[
          { label: 'Voices cast', val: `${castN}/${cast.length}`, done: audioPct === 100 },
          { label: 'Lines approved', val: '—', done: false },
        ]} />
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-[#3772cf]/10 text-[#3772cf]"><Icon name="film" size={22} /></span>
            <div><h3 className="mb-1.5 text-base font-semibold text-ink">Animatic</h3><Pill tone="warning" dot>Draft</Pill></div>
          </div>
          <p className="text-sm text-stone">Sequence assembled; not yet marked final. Review the timed cut before advancing.</p>
          <button onClick={() => navigate(`/project/${id}/pre/animatic`)} className="inline-flex items-center gap-1 self-start text-sm font-medium text-[#3772cf] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] rounded">
            Open animatic <Icon name="chevron-right" size={14} />
          </button>
        </Card>
      </div>

      <div className={`flex items-center gap-3 rounded-lg border p-4 ${ready ? 'border-[#00b48a]/30 bg-[#00b48a]/5' : 'border-brand-warn/30 bg-brand-warn/5'}`}>
        <span className={ready ? 'text-[#00b48a]' : 'text-brand-warn'}><Icon name={ready ? 'check' : 'clock'} size={18} /></span>
        <div className="flex flex-col">
          <b className="text-sm text-ink">{ready ? 'Ready for production' : 'Not ready yet'}</b>
          <span className="text-sm text-stone">{ready ? 'Every track meets its minimum bar.' : `Blocking: ${blockers.join(' · ')}.`}</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button variant="primary" size="lg" iconRight="arrow-right" disabled={!ready}>Send to Production</Button>
        {!ready && <span className="text-xs text-stone">Enabled once all tracks pass and the animatic is final.</span>}
      </div>
    </div>
  )
}
