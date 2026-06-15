// frontend/src/components/refine/EntityRegistryPanel.tsx
import { useEffect, useState, type ReactNode } from 'react'
import {
  getEntities, saveEntities,
  type CharacterDescription, type CharacterVoice, type EntityEntry,
  type EntityRegistry, type LocationDescription,
} from '../../api/pipeline'
import { parseAliases, formatAliases } from './entities'

const ctrl = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'
const field = `w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink ${ctrl}`
const sectionLabel = 'text-[11px] uppercase tracking-wider font-mono text-[#3772cf]'

interface Props {
  episodeId: string
  refreshKey?: number  // bump to re-fetch after a parse (panel is otherwise stale)
  // When active, render rows streamed from a live parse instead of the editable
  // fetched registry; entities appear as their descriptions are produced.
  liveStream?: { active: boolean; characters: EntityEntry[]; locations: EntityEntry[] }
}

type Kind = 'characters' | 'locations'

function descSummary(e: EntityEntry): string {
  return (e.description as { summary?: string } | null | undefined)?.summary?.trim() || ''
}

const emptyCharDesc = (): CharacterDescription =>
  ({ summary: '', appearance: '', attire: '', age_build: '', palette: '' })
const emptyLocDesc = (): LocationDescription =>
  ({ summary: '', setting: '', lighting: '', time_variants: [] })
const emptyVoice = (): CharacterVoice =>
  ({ register: '', tone: '', pace: '', dominant_emotion: '', dominant_intensity: '', line_count: 0 })

const CHAR_FIELDS: [keyof CharacterDescription, string][] = [
  ['appearance', 'Appearance'], ['attire', 'Attire'],
  ['age_build', 'Age & build'], ['palette', 'Palette'],
]
const LOC_FIELDS: [keyof LocationDescription, string][] = [
  ['setting', 'Setting'], ['lighting', 'Lighting'],
]
const VOICE_FIELDS: [keyof CharacterVoice, string][] = [
  ['register', 'Register'], ['tone', 'Tone'], ['pace', 'Pace'],
]

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-stone">{label}</span>
      {children}
    </label>
  )
}

export function EntityRegistryPanel({ episodeId, refreshKey = 0, liveStream }: Props) {
  const [reg, setReg] = useState<EntityRegistry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const streaming = !!liveStream?.active

  useEffect(() => {
    if (streaming) return  // streamed rows drive the panel during a live parse
    let alive = true
    setLoading(true); setError(''); setOpen(new Set())
    getEntities(episodeId)
      .then(r => { if (alive) { setReg(r); setDirty(false) } })
      .catch(e => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [episodeId, refreshKey, streaming])

  if (streaming && liveStream) {
    return (
      <div className="rounded-lg border border-hairline bg-canvas p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink">Names &amp; locations</h3>
          <span className="text-[10px] text-stone">streaming…</span>
        </div>
        {(['characters', 'locations'] as Kind[]).map(kind => {
          const list = liveStream[kind]
          return (
            <div key={kind} className="mb-4 last:mb-0">
              <div className={`${sectionLabel} mb-1.5`}>{kind}</div>
              {list.length === 0 ? (
                <div className="space-y-1.5" aria-hidden="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-9 rounded-md bg-surface animate-pulse" />
                  ))}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((e, i) => (
                    <li key={e.canonical || i} className="rounded-md border border-hairline bg-surface/40 px-2.5 py-1.5">
                      <div className="text-xs font-medium text-ink">{e.canonical}</div>
                      {descSummary(e) && <div className="text-[11px] text-stone truncate">{descSummary(e)}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function toggle(key: string) {
    setOpen(s => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function edit(kind: Kind, i: number, patch: Partial<EntityEntry>) {
    setReg(r => {
      if (!r) return r
      const list = [...r[kind]]
      list[i] = { ...list[i], ...patch }
      return { ...r, [kind]: list }
    })
    setDirty(true)
  }

  // A description/voice edit marks the entry human-owned so re-parsing won't overwrite it.
  function editDesc(kind: Kind, i: number, patch: Record<string, unknown>) {
    const cur = reg?.[kind][i]
    const base = cur?.description ?? (kind === 'characters' ? emptyCharDesc() : emptyLocDesc())
    edit(kind, i, { description: { ...base, ...patch } as EntityEntry['description'], generated: false })
  }
  function editVoice(i: number, patch: Partial<CharacterVoice>) {
    const cur = reg?.characters[i]
    const base = cur?.voice ?? emptyVoice()
    edit('characters', i, { voice: { ...base, ...patch }, generated: false })
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

  function renderEntry(kind: Kind, e: EntityEntry, i: number) {
    const key = `${kind}:${i}`
    const expanded = open.has(key)
    const desc = e.description as (CharacterDescription & LocationDescription) | null | undefined
    const summary = desc?.summary?.trim() || ''
    const voice = e.voice
    return (
      <div key={e.canonical || i} className="rounded-md border border-hairline bg-surface/40">
        <div className="flex gap-1.5 p-1.5">
          <button onClick={() => toggle(key)} aria-label={expanded ? 'Collapse' : 'Expand description'}
            aria-expanded={expanded}
            className={`shrink-0 w-6 grid place-items-center text-stone hover:text-[#3772cf] rounded-md transition-colors ${ctrl}`}>
            <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
          </button>
          <input className={field + ' w-1/3'} value={e.canonical}
            onChange={ev => edit(kind, i, { canonical: ev.target.value })} placeholder="Canonical" />
          <input className={field} value={formatAliases(e.aliases)}
            onChange={ev => edit(kind, i, { aliases: parseAliases(ev.target.value) })}
            placeholder="Aliases (comma-separated)" />
          <button onClick={() => remove(kind, i)} aria-label="Remove entry"
            className={`shrink-0 text-stone hover:text-brand-error px-1 rounded-md transition-colors ${ctrl}`}>×</button>
        </div>

        {!expanded && summary && (
          <p className="px-2 pb-2 -mt-0.5 text-xs text-stone truncate">{summary}</p>
        )}

        {expanded && (
          <div className="border-t border-hairline px-2.5 py-2.5 space-y-3">
            <Labeled label="Summary">
              <input className={field} value={desc?.summary ?? ''}
                onChange={ev => editDesc(kind, i, { summary: ev.target.value })}
                placeholder="One-line description" />
            </Labeled>

            <div className="grid grid-cols-2 gap-2">
              {(kind === 'characters' ? CHAR_FIELDS : LOC_FIELDS).map(([f, label]) => (
                <Labeled key={f} label={label}>
                  <input className={field} value={(desc?.[f] as string) ?? ''}
                    onChange={ev => editDesc(kind, i, { [f]: ev.target.value })} placeholder="—" />
                </Labeled>
              ))}
            </div>

            {kind === 'locations' && (
              <Labeled label="Times of day">
                <input className={field} value={formatAliases(desc?.time_variants ?? [])}
                  onChange={ev => editDesc(kind, i, { time_variants: parseAliases(ev.target.value) })}
                  placeholder="day, night, sunset" />
              </Labeled>
            )}

            {kind === 'characters' && (
              <div className="space-y-2">
                <div className={sectionLabel}>Voice</div>
                <div className="grid grid-cols-3 gap-2">
                  {VOICE_FIELDS.map(([f, label]) => (
                    <Labeled key={f} label={label}>
                      <input className={field} value={(voice?.[f] as string) ?? ''}
                        onChange={ev => editVoice(i, { [f]: ev.target.value } as Partial<CharacterVoice>)}
                        placeholder="—" />
                    </Labeled>
                  ))}
                </div>
                {voice && (voice.line_count > 0 || voice.dominant_emotion) && (
                  <p className="text-xs text-stone">
                    {voice.line_count} line{voice.line_count === 1 ? '' : 's'}
                    {voice.dominant_emotion && <> · mostly <span className="text-steel">{voice.dominant_emotion}</span></>}
                    {voice.dominant_intensity && <> · {voice.dominant_intensity} intensity</>}
                  </p>
                )}
              </div>
            )}

            {e.appears_in && e.appears_in.length > 0 && (
              <p className="text-xs text-stone">Appears in {e.appears_in.length} scene{e.appears_in.length === 1 ? '' : 's'}</p>
            )}
          </div>
        )}
      </div>
    )
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
              <div className={`${sectionLabel} mb-1.5`}>{kind}</div>
              <div className="space-y-1.5">
                {reg[kind].map((e, i) => renderEntry(kind, e, i))}
                {reg[kind].length === 0 && <p className="text-xs text-stone">None.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
