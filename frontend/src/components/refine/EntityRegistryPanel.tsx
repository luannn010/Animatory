// frontend/src/components/refine/EntityRegistryPanel.tsx
import { useEffect, useState } from 'react'
import { getEntities, saveEntities, type EntityEntry, type EntityRegistry } from '../../api/pipeline'
import { parseAliases, formatAliases } from './entities'

const ctrl = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'
const field = `w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink ${ctrl}`

interface Props { episodeId: string }

type Kind = 'characters' | 'locations'

export function EntityRegistryPanel({ episodeId }: Props) {
  const [reg, setReg] = useState<EntityRegistry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    getEntities(episodeId)
      .then(r => { if (alive) { setReg(r); setDirty(false) } })
      .catch(e => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [episodeId])

  function edit(kind: Kind, i: number, patch: Partial<EntityEntry>) {
    setReg(r => {
      if (!r) return r
      const list = [...r[kind]]
      list[i] = { ...list[i], ...patch }
      return { ...r, [kind]: list }
    })
    setDirty(true)
  }
  function remove(kind: Kind, i: number) {
    setReg(r => (r ? { ...r, [kind]: r[kind].filter((_, j) => j !== i) } : r))
    setDirty(true)
  }
  async function save() {
    if (!reg) return
    setSaving(true); setError('')
    try {
      const next = await saveEntities(episodeId, { characters: reg.characters, locations: reg.locations })
      setReg(next); setDirty(false)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Names &amp; locations</h3>
        <button onClick={save} disabled={!dirty || saving || !reg}
          className={`px-3 py-1.5 rounded-md bg-[#3772cf] text-white text-xs font-medium hover:bg-[#2c5cab] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${ctrl}`}>
          {saving ? 'Saving…' : dirty ? 'Save ●' : 'Saved'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 rounded-md bg-surface animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-brand-error">{error}</p>
      ) : reg && (reg.characters.length === 0 && reg.locations.length === 0) ? (
        <p className="text-xs text-stone">No names learned yet. Parse a chapter to populate this list.</p>
      ) : reg && (
        <div className="space-y-4">
          {(['characters', 'locations'] as Kind[]).map(kind => (
            <div key={kind}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone mb-1.5">{kind}</div>
              <div className="space-y-1.5">
                {reg[kind].map((e, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input className={field + ' w-1/3'} value={e.canonical}
                      onChange={ev => edit(kind, i, { canonical: ev.target.value })} placeholder="Canonical" />
                    <input className={field} value={formatAliases(e.aliases)}
                      onChange={ev => edit(kind, i, { aliases: parseAliases(ev.target.value) })}
                      placeholder="Aliases (comma-separated)" />
                    <button onClick={() => remove(kind, i)} aria-label="Remove entry"
                      className={`text-stone hover:text-brand-error px-1 rounded-md transition-colors ${ctrl}`}>×</button>
                  </div>
                ))}
                {reg[kind].length === 0 && <p className="text-xs text-stone">None.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
