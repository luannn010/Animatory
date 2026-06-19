import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DesignAsset, DesignKind } from '../../types'
import { loadDesignAssets } from '../../entityAssets'
import { Card, Pill, StageBadge, PlateThumb, Button } from '../../ui'
import { TrackHeaderStrip, SectionLabel } from '../../ui'

function AssetCard({ asset, onOpen, onDeform }: {
  asset: DesignAsset; onOpen: (a: DesignAsset) => void; onDeform?: (a: DesignAsset) => void
}) {
  const hasArt = asset.stage !== 'rough' || asset.candidates.length > 0 || !!asset.refImageUrl
  const canDeform = asset.kind === 'character' && !!asset.refImageUrl && !!onDeform
  return (
    <Card interactive flush className="overflow-hidden" onClick={() => onOpen(asset)}>
      <PlateThumb
        id={asset.id} kind={asset.kind} ratio="4 / 3"
        locked={asset.stage === 'locked'} empty={!hasArt}
        src={asset.refImageUrl ?? undefined} alt={asset.displayName}
        label={asset.kind === 'prop' ? 'Not generated' : 'Placeholder'}
      />
      <div className="flex flex-col gap-2 px-3 pt-3 pb-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink truncate">{asset.displayName}</span>
          <StageBadge stage={asset.stage} />
        </div>
        {asset.summary ? (
          <p className="text-xs text-stone line-clamp-2">{asset.summary}</p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs capitalize text-stone">{asset.kind}</span>
            <Pill tone="neutral">{asset.candidates.length} {asset.candidates.length === 1 ? 'candidate' : 'candidates'}</Pill>
          </div>
        )}
        {canDeform && (
          <button
            onClick={e => { e.stopPropagation(); onDeform!(asset) }}
            className="mt-0.5 inline-flex items-center justify-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs font-medium text-steel transition-colors hover:border-[#3772cf]/50 hover:text-[#3772cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]"
          >
            Open in deform
          </button>
        )}
      </div>
    </Card>
  )
}

function Section({ kind, label, icon, assets, onOpen, onDeform, action }: {
  kind: DesignKind; label: string; icon: 'user' | 'map-pin' | 'package'
  assets: DesignAsset[]; onOpen: (a: DesignAsset) => void; onDeform?: (a: DesignAsset) => void; action?: React.ReactNode
}) {
  const items = assets.filter(a => a.kind === kind)
  return (
    <section className="mb-8 last:mb-0">
      <SectionLabel icon={icon} count={items.length} action={action}>{label}</SectionLabel>
      {items.length === 0 ? (
        <p className="text-xs text-stone">None yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
          {items.map(a => <AssetCard key={a.id} asset={a} onOpen={onOpen} onDeform={onDeform} />)}
        </div>
      )}
    </section>
  )
}

export function DesignTrackView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [assets, setAssets] = useState<DesignAsset[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setAssets(null); setError('')
    loadDesignAssets(id)
      .then(a => { if (alive) setAssets(a) })
      .catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [id])

  const open = (a: DesignAsset) => navigate(`/project/${id}/pre/design/${a.kind}/${a.id}`)
  const openDeform = () => navigate('/deform')

  if (error) return <p className="text-sm text-brand-error">{error}</p>
  if (!assets) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-56 rounded-lg anmt-skeleton" />)}
      </div>
    )
  }

  const locked = assets.filter(a => a.stage === 'locked').length
  return (
    <div>
      <TrackHeaderStrip
        title="Design"
        sub="Every character, location and prop — auto-seeded from the entity registry."
        done={locked} total={assets.length} unit="locked"
      />
      <Section kind="character" label="Characters" icon="user" assets={assets} onOpen={open} onDeform={openDeform} />
      <Section kind="location" label="Locations" icon="map-pin" assets={assets} onOpen={open} />
      <Section
        kind="prop" label="Props" icon="package" assets={assets} onOpen={open}
        action={<Button size="sm" variant="secondary" icon="plus">Add prop</Button>}
      />
    </div>
  )
}
