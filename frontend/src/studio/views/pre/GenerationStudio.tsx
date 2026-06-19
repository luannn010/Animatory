import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DesignAsset, DesignKind, DesignStage } from '../../types'
import { loadDesignAssets } from '../../entityAssets'
import { Button, Card, Chip, Icon, PlateThumb, Textarea, BackLink } from '../../ui'

const STAGE_LABEL: Record<DesignStage, string> = {
  rough: 'Rough', color: 'Color', locked: 'Locked',
}

function StageSelector({ stages, value, onChange }: {
  stages: DesignStage[]; value: DesignStage; onChange: (s: DesignStage) => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-4">
      <span className="text-[10px] font-medium uppercase tracking-wider text-stone">Design stage</span>
      <div className="flex flex-col gap-0.5">
        {stages.map((st, i) => {
          const active = st === value
          const done = stages.indexOf(value) > i
          return (
            <button
              key={st} onClick={() => onChange(st)}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf] ${
                active ? 'bg-[#3772cf]/10 text-[#3772cf]' : done ? 'text-ink hover:bg-surface' : 'text-stone hover:bg-surface'
              }`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                done ? 'bg-[#00b48a] text-white' : active ? 'bg-[#3772cf] text-white' : 'bg-surface text-stone'
              }`}>
                {done ? <Icon name="check" size={12} /> : i + 1}
              </span>
              {STAGE_LABEL[st]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Candidate({ id, kind, ratio, index, selected, onSelect }: {
  id: string; kind: DesignKind; ratio: string; index: number; selected: boolean; onSelect: () => void
}) {
  return (
    <Card interactive selected={selected} flush className="group relative overflow-hidden" onClick={onSelect}>
      <PlateThumb id={`${id}-c${index}`} kind={kind} ratio={ratio} />
      <div className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border transition-opacity ${
        selected
          ? 'border-[#3772cf] bg-[#3772cf] text-white opacity-100'
          : 'border-white/70 bg-black/30 text-white opacity-0 group-hover:opacity-100'
      }`}>
        <Icon name="check" size={14} />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/65 to-transparent px-2.5 py-2">
        <span className="font-mono text-[11px] text-white/90">v{index + 1}</span>
        <button
          title="Regenerate" aria-label="Regenerate candidate"
          onClick={e => { e.stopPropagation() }}
          className="text-white/70 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>
    </Card>
  )
}

interface Config {
  kind: DesignKind
  stages: DesignStage[]
  ratio: string
  useReference?: boolean
  useTags?: boolean
}

export function GenerationStudio({ kind, stages, ratio, useReference, useTags }: Config) {
  const { id = '', assetId = '' } = useParams()
  const navigate = useNavigate()
  const [asset, setAsset] = useState<DesignAsset | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let alive = true
    setAsset(null); setMissing(false)
    loadDesignAssets(id).then(all => {
      if (!alive) return
      const found = all.find(a => a.id === assetId && a.kind === kind) || all.find(a => a.id === assetId)
      found ? setAsset(found) : setMissing(true)
    }).catch(() => alive && setMissing(true))
    return () => { alive = false }
  }, [id, assetId, kind])

  if (missing) {
    return (
      <div>
        <BackLink onClick={() => navigate(`/project/${id}/pre/design`)}>Design</BackLink>
        <p className="mt-4 text-sm text-stone">Asset not found.</p>
      </div>
    )
  }
  if (!asset) {
    return (
      <div>
        <BackLink onClick={() => navigate(`/project/${id}/pre/design`)}>Design</BackLink>
        <div className="mt-4 grid grid-cols-[340px_1fr] gap-6" aria-hidden="true">
          <div className="h-96 rounded-lg anmt-skeleton" />
          <div className="h-96 rounded-lg anmt-skeleton" />
        </div>
      </div>
    )
  }

  return <StudioBody key={asset.id} asset={asset} kind={kind} stages={stages} ratio={ratio}
    useReference={useReference} useTags={useTags} onBack={() => navigate(`/project/${id}/pre/design`)}
    onOpenRig={kind === 'character' ? () => navigate(`/project/${id}/pre/rig/${asset.id}`) : undefined} />
}

function StudioBody({ asset, kind, stages, ratio, useReference, useTags, onBack, onOpenRig }: Config & { asset: DesignAsset; onBack: () => void; onOpenRig?: () => void }) {
  const [stage, setStage] = useState<DesignStage>(asset.stage)
  const [prompt, setPrompt] = useState(asset.promptText)
  const [generating, setGenerating] = useState(false)
  const [count, setCount] = useState(asset.candidates.length)
  const [selected, setSelected] = useState<number | null>(asset.candidates.length > 0 ? 0 : null)
  const [tags, setTags] = useState<Record<string, boolean>>({ Cinematic: true, 'Cool grade': true, 'Wide plate': kind === 'location', Noir: false })
  const empty = count === 0

  const generate = () => {
    setGenerating(true)
    setTimeout(() => { setGenerating(false); setCount(c => Math.max(c, 4)); setSelected(s => s ?? 0) }, 1600)
  }
  const lockLabel = useReference ? 'Lock reference' : kind === 'location' ? 'Lock background' : 'Lock design'
  const gridCols = useMemo(
    () => kind === 'location' ? 'grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'
      : kind === 'prop' ? 'grid-cols-[repeat(auto-fill,minmax(170px,1fr))]'
      : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]',
    [kind],
  )

  return (
    <div>
      <BackLink onClick={onBack}>Design</BackLink>

      {stage === 'locked' && (
        <div className="mt-3 flex items-center gap-4 rounded-lg border border-[#00b48a]/30 bg-[#00b48a]/5 p-4">
          <div className="w-[72px] shrink-0"><PlateThumb id={asset.id} kind={kind} ratio={ratio} locked /></div>
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#00b48a]">
              <Icon name="lock" size={12} /> Locked reference
            </span>
            <span className="text-base font-semibold text-ink">{asset.displayName}</span>
            <span className="font-mono text-xs text-stone">{asset.id}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {onOpenRig && (
              <Button size="sm" variant="secondary" icon="layers" onClick={onOpenRig}>Rig character</Button>
            )}
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setStage('color')}>Unlock &amp; revise</Button>
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* Brief */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <div>
            <h1 className="text-lg font-semibold text-ink">{asset.displayName}</h1>
            <span className="font-mono text-xs text-stone">{asset.id}</span>
          </div>

          <Textarea label="Generation prompt" rows={kind === 'prop' ? 4 : 6} value={prompt} onChange={e => setPrompt(e.target.value)} />

          {useReference && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-stone">Consistency anchor</span>
              <div className="flex items-center gap-3">
                <div className="w-16 shrink-0 rounded-md overflow-hidden"><PlateThumb id={`${asset.id}-ref`} kind={kind} ratio="1 / 1" /></div>
                <div className="flex flex-col gap-1 text-sm text-stone">
                  <span>Reference image</span>
                  <button className="text-left text-xs font-medium text-[#3772cf] hover:underline">Replace</button>
                </div>
              </div>
            </div>
          )}

          {useTags && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-stone">Style &amp; mood</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(tags).map(t => (
                  <Chip key={t} selected={tags[t]} onClick={() => setTags(s => ({ ...s, [t]: !s[t] }))}>{t}</Chip>
                ))}
              </div>
            </div>
          )}

          <Button variant="primary" size="lg" block icon="sparkles" loading={generating} onClick={generate}>
            {generating ? 'Generating…' : useReference ? 'Generate' : 'Generate background'}
          </Button>

          <StageSelector stages={stages} value={stage} onChange={setStage} />
        </aside>

        {/* Gallery */}
        <main>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">{useReference ? 'Model sheet' : 'Candidates'}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon="refresh" disabled={generating} onClick={generate}>Regenerate</Button>
              <Button size="sm" variant="ghost" icon="upload">Upload manually</Button>
            </div>
          </div>

          {empty && !generating ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline px-6 py-12 text-center text-stone">
              <Icon name="sparkles" size={28} />
              <p className="font-medium text-steel">No candidates yet.</p>
              <span className="text-sm">Write a prompt and generate the first {kind === 'prop' ? 'prop design' : 'plate'}.</span>
            </div>
          ) : (
            <div className={`grid gap-3 ${gridCols}`}>
              {generating && Array.from({ length: 4 }).map((_, i) => (
                <div key={`sk${i}`} className="rounded-lg anmt-skeleton" style={{ aspectRatio: ratio }} />
              ))}
              {!generating && Array.from({ length: count }).map((_, i) => (
                <Candidate key={i} id={asset.id} kind={kind} ratio={ratio} index={i} selected={selected === i} onSelect={() => setSelected(i)} />
              ))}
            </div>
          )}

          {!empty && !generating && (
            <div className="mt-5 flex items-center justify-between border-t border-hairline pt-4">
              <span className="text-sm text-stone">{selected != null ? `Candidate v${selected + 1} selected` : 'Select a candidate to lock'}</span>
              <Button variant="primary" icon="lock" disabled={selected == null || stage === 'locked'} onClick={() => setStage('locked')}>{lockLabel}</Button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
