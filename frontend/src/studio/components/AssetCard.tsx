import type { Asset, AssetStatus } from '../types'

const STATUS_STYLES: Record<AssetStatus, string> = {
  rough: 'bg-[#c37d0d]/10 text-[#c37d0d]',
  clean: 'bg-[#3772cf]/10 text-[#3772cf]',
  color: 'bg-[#7c3aed]/10 text-[#7c3aed]',
  done:  'bg-[#00b48a]/10 text-[#00b48a]',
}

interface Props { asset: Asset }

export function AssetCard({ asset }: Props) {
  return (
    <div className="bg-canvas border border-hairline rounded-md overflow-hidden">
      <div className="h-20 bg-surface flex items-center justify-center text-2xl overflow-hidden">
        {asset.thumbnailUrl
          ? <img src={asset.thumbnailUrl} alt={asset.name} className="w-full h-full object-cover" />
          : <span aria-hidden="true">{asset.emoji}</span>}
      </div>
      <div className="p-2.5">
        <div className="text-xs font-medium text-ink mb-1 truncate">{asset.name}</div>
        <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded-xs ${STATUS_STYLES[asset.status]}`}>
          {asset.status}
        </span>
      </div>
    </div>
  )
}
