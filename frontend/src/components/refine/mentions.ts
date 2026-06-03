// frontend/src/components/refine/mentions.ts
import type { ChatMention } from '../../api/chat'

/**
 * Extract @Scene<N> and @raw mentions from a draft. @Scene<N> resolves to the
 * current chunk's scene id ending in _S0<N> — so it can never point at another
 * chapter's scene. Unknown numbers are ignored; results are de-duplicated.
 */
export function parseMentions(draft: string, sceneIds: string[]): ChatMention {
  const raw = /(^|\s)@raw\b/i.test(draft)
  const scenes: string[] = []
  const re = /(^|\s)@Scene(\d{1,3})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(draft)) !== null) {
    const n = m[2].padStart(2, '0')
    const id = sceneIds.find(s => s.endsWith(`_S${n}`))
    if (id && !scenes.includes(id)) scenes.push(id)
  }
  return { scenes, raw }
}
