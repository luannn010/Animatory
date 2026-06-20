// frontend/src/components/refine/enrichStream.ts
// Pure fold of a streamed `entity_described` event into the editable entity
// registry: upsert the server-merged entry by canonical into the right list.
// Mirrors studio/parseStream.ts's upsert; kept side-effect-free so it is unit-tested.
import type { EntityEntry, EntityRegistry } from '../../api/pipeline'
import type { RunEvent } from '../../types'

/** Returns a new registry with the streamed entity upserted, or the SAME reference
 *  for non-entity events / malformed entries (lets callers skip a re-render). */
export function applyEnrichEvent(reg: EntityRegistry, event: RunEvent): EntityRegistry {
  if (event.type !== 'entity_described') return reg
  const entry = event.data.entry as unknown as EntityEntry | undefined
  if (!entry || !entry.canonical) return reg
  const kind = event.data.kind === 'location' ? 'locations' : 'characters'
  const list = reg[kind]
  const i = list.findIndex(e => e.canonical === entry.canonical)
  const next = i === -1 ? [...list, entry] : list.map((e, j) => (j === i ? entry : e))
  return { ...reg, [kind]: next }
}
