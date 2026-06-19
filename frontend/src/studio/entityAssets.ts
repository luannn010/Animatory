// Bridges the real entity registry (the parsed + enriched characters/locations)
// into the studio's DesignAsset shape used by the Design track. Pure mappers are
// unit-tested; loadDesignAssets adds the live fetch with a mock fallback.
import type {
  EntityEntry, CharacterDescription, LocationDescription, EntityRegistry,
} from '../api/pipeline'
import { getEntities, listEpisodes } from '../api/pipeline'
import type { DesignAsset, DesignKind } from './types'
import { studioApi } from './api'
import { deformApi } from './deformApi'

/** URL-safe id from a canonical name (diacritics stripped, non-alnum → '-'). */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entity'
}

function joinParts(parts: (string | undefined)[]): string {
  return parts.map(p => (p || '').trim()).filter(Boolean).join('. ')
}

/** Compose a generation-prompt seed from an enrichment description block. */
export function composePrompt(kind: DesignKind, description: unknown): string {
  if (!description || typeof description !== 'object') return ''
  if (kind === 'location') {
    const d = description as Partial<LocationDescription>
    const base = joinParts([d.summary, d.setting, d.lighting])
    const times = (d.time_variants || []).join(', ')
    return times ? `${base}${base ? '. ' : ''}Times of day: ${times}.` : base
  }
  const d = description as Partial<CharacterDescription>
  return joinParts([d.summary, d.appearance, d.attire, d.age_build, d.palette])
}

function entityToDesignAsset(entity: EntityEntry, kind: DesignKind, projectId: string): DesignAsset {
  const desc = entity.description
  const summary = (desc as { summary?: string } | null | undefined)?.summary?.trim() || ''
  return {
    id: slug(entity.canonical),
    projectId,
    kind,
    sourceEntity: entity.canonical,
    displayName: entity.canonical,
    promptText: composePrompt(kind, desc),
    refImageUrl: null,
    stage: 'rough',
    candidates: [],
    lockedRef: null,
    summary: summary || undefined,
  }
}

/** Map a fetched entity registry to design assets (characters + locations). */
export function mapEntities(registry: EntityRegistry, projectId: string): DesignAsset[] {
  const chars = (registry.characters || []).map(e => entityToDesignAsset(e, 'character', projectId))
  const locs = (registry.locations || []).map(e => entityToDesignAsset(e, 'location', projectId))
  return [...chars, ...locs]
}

/** Pick the episode that backs a project: the first whose id starts with the
 *  project id (episodes are namespaced `{projectId}__{slug}`), else any. */
async function resolveEpisodeId(projectId: string): Promise<string | null> {
  try {
    const eps = await listEpisodes()
    if (eps.length === 0) return null
    const owned = eps.find(e => e.episode_id === projectId || e.episode_id.startsWith(`${projectId}__`))
    return (owned || eps[0]).episode_id
  } catch {
    return null
  }
}

/**
 * Design assets for a project: real parsed entities when an episode exists,
 * otherwise the mock fixtures. Mock props are appended either way (the entity
 * registry has no props yet — recurring items aren't part of it).
 */
export async function loadDesignAssets(projectId: string): Promise<DesignAsset[]> {
  const episodeId = await resolveEpisodeId(projectId)
  let base: DesignAsset[] | null = null
  if (episodeId) {
    try {
      const registry = await getEntities(episodeId)
      const real = mapEntities(registry, projectId)
      if (real.length > 0) {
        const mockProps = (await studioApi.getDesignAssets(projectId)).filter(a => a.kind === 'prop')
        base = [...real, ...mockProps]
      }
    } catch {
      /* fall through to mock */
    }
  }
  if (base === null) base = await studioApi.getDesignAssets(projectId)
  return mergeGeneratedCharacters(base, projectId)
}

/**
 * Fold Z-Image rig renders (imagegen rig assets) into the design assets as
 * characters with real `refImageUrl` art. A generated character that matches an
 * existing entry (by slug) fills in that entry's art; otherwise it is appended.
 * Network failure is non-fatal — the base list is returned unchanged.
 */
async function mergeGeneratedCharacters(base: DesignAsset[], projectId: string): Promise<DesignAsset[]> {
  let rigs
  try { rigs = await deformApi.listRigAssets() } catch { return base }
  if (!rigs.length) return base
  const out = [...base]
  for (const r of rigs) {
    if (!r.imageUrl) continue
    const name = r.characterId || 'character'
    const id = slug(name)
    const url = deformApi.imageSrc(r.imageUrl)
    const idx = out.findIndex(a => a.kind === 'character' && (a.id === id || slug(a.sourceEntity) === id))
    if (idx >= 0) {
      if (!out[idx].refImageUrl) {
        out[idx] = { ...out[idx], refImageUrl: url, stage: out[idx].stage === 'rough' ? 'color' : out[idx].stage }
      }
    } else {
      out.push({
        id, projectId, kind: 'character', sourceEntity: name, displayName: name,
        promptText: '', refImageUrl: url, stage: 'color', candidates: [], lockedRef: null,
        summary: 'Generated with Z-Image',
      })
    }
  }
  return out
}
