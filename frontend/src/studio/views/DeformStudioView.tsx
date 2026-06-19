import { useEffect, useState } from 'react'
import { deformApi, type RigAsset } from '../deformApi'
import { DeformWorkspace } from '../DeformWorkspace'

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

// Standalone deform page: a character picker over the shared DeformWorkspace.
export function DeformStudioView() {
  const [assets, setAssets] = useState<RigAsset[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [selected, setSelected] = useState<RigAsset | null>(null)

  useEffect(() => {
    let alive = true
    deformApi.listRigAssets()
      .then(rows => { if (alive) { setAssets(rows); setSelected(rows[0] ?? null) } })
      .catch(e => { if (alive) setLoadErr(String(e)) })
    return () => { alive = false }
  }, [])

  if (loadErr) return (
    <div className="mx-auto max-w-md rounded-lg border border-hairline bg-canvas p-6 text-center">
      <p className="text-sm font-medium text-ink">Couldn’t reach the backend</p>
      <p className="mt-1 text-xs text-stone">{loadErr}</p>
      <p className="mt-2 text-xs text-stone">Start it on :8000, then reload.</p>
    </div>
  )
  if (assets === null) return <div className="h-[560px] rounded-lg anmt-skeleton" aria-hidden="true" />
  if (assets.length === 0) return (
    <div className="mx-auto max-w-md rounded-lg border border-hairline bg-canvas p-6 text-center">
      <p className="text-sm font-medium text-ink">No characters to deform yet</p>
      <p className="mt-1 text-xs text-stone">Generate a character with Z-Image first — it’ll appear here as a rig asset.</p>
    </div>
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-hairline pb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Mesh deform</h1>
          <span className="font-mono text-xs text-stone">
            {(selected?.characterId || selected?.jobId || '—')} · triangulate → texture → pose
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
        <aside>
          <h2 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-[#3772cf]">Characters</h2>
          <ul className="space-y-1.5">
            {assets.map(a => {
              const sel = a.jobId === selected?.jobId
              return (
                <li key={a.jobId}>
                  <button onClick={() => setSelected(a)}
                    className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition-colors ${ring} ${
                      sel ? 'border-[#3772cf] bg-[#3772cf]/5' : 'border-hairline hover:border-[#3772cf]/50'
                    }`}>
                    <img src={deformApi.imageSrc(a.imageUrl)} alt="" className="h-12 w-9 rounded-xs border border-hairline object-cover" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink">{a.characterId || 'character'}</span>
                      <span className="block truncate font-mono text-[10px] text-stone">{a.jobId.slice(0, 8)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        {selected && <DeformWorkspace key={selected.jobId} character={selected} />}
      </div>
    </div>
  )
}
