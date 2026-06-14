// frontend/src/studio/parseStream.ts
// Pure reducer for the live parse stream: folds RunEvents into the progressive
// UI state (scenes revealed per chunk, then entities-with-descriptions and voice
// profiles streamed in). Kept side-effect-free so it is unit-testable.
import type { EntityEntry, PipelineScene, VoiceProfile } from '../api/pipeline'
import type { RunEvent } from '../types'

export type ParsePhase = 'scenes' | 'describing' | 'summaries'

export interface ParseStreamState {
  phase: ParsePhase
  scenes: PipelineScene[]
  scenesReceived: boolean   // this chunk's chunk_parsed has arrived
  characters: EntityEntry[]
  locations: EntityEntry[]
  profiles: VoiceProfile[]
}

export function initialParseStream(): ParseStreamState {
  return { phase: 'scenes', scenes: [], scenesReceived: false, characters: [], locations: [], profiles: [] }
}

export const PHASE_LABEL: Record<ParsePhase, string> = {
  scenes: 'Extracting scenes…',
  describing: 'Describing characters & locations…',
  summaries: 'Writing scene summaries…',
}

function upsert(list: EntityEntry[], entry: EntityEntry): EntityEntry[] {
  const i = list.findIndex(e => e.canonical === entry.canonical)
  if (i === -1) return [...list, entry]
  const next = list.slice()
  next[i] = entry
  return next
}

/** Fold one streamed event into the parse state. `chunkId` scopes `chunk_parsed`
 *  to the chapter being viewed (enrichment events are episode-wide). */
export function applyParseEvent(state: ParseStreamState, event: RunEvent, chunkId: string): ParseStreamState {
  const d = event.data
  switch (event.type) {
    case 'phase':
      return d.phase ? { ...state, phase: d.phase as ParsePhase } : state
    case 'chunk_parsed':
      if (d.chunk_id !== chunkId) return state
      return { ...state, scenes: (d.scenes as PipelineScene[]) ?? [], scenesReceived: true }
    case 'voice_profiles':
      return { ...state, profiles: (d.profiles as VoiceProfile[]) ?? [] }
    case 'entity_described': {
      const entry = d.entry as unknown as EntityEntry | undefined
      if (!entry || !entry.canonical) return state
      return d.kind === 'location'
        ? { ...state, locations: upsert(state.locations, entry) }
        : { ...state, characters: upsert(state.characters, entry) }
    }
    case 'scene_summary':
      return {
        ...state,
        scenes: state.scenes.map(s => (s.scene_id === d.scene_id ? { ...s, summary: d.summary ?? null } : s)),
      }
    default:
      return state
  }
}
