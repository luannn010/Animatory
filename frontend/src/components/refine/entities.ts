// frontend/src/components/refine/entities.ts
export function parseAliases(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

export function formatAliases(aliases: string[]): string {
  return aliases.join(', ')
}
