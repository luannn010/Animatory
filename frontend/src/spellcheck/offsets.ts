// frontend/src/spellcheck/offsets.ts
import type { Finding } from './types'

/** True when the finding's recorded span still equals its original text. */
export function verify(text: string, f: Finding): boolean {
  return text.slice(f.char_start, f.char_end) === f.original
}

/** Find `original` near the expected offset; returns a new span or null. */
function relocate(text: string, f: Finding): { char_start: number; char_end: number } | null {
  if (!f.original) return null
  // Prefer the closest occurrence to the expected start.
  let best: number | null = null
  let from = 0
  for (;;) {
    const idx = text.indexOf(f.original, from)
    if (idx < 0) break
    if (best === null || Math.abs(idx - f.char_start) < Math.abs(best - f.char_start)) best = idx
    from = idx + 1
  }
  if (best === null) return null
  return { char_start: best, char_end: best + f.original.length }
}

function splice(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end)
}

/** Apply one finding by id. Verifies (and relocates) before splicing; on an
 *  unrecoverable mismatch marks the finding stale and changes nothing. Shifts
 *  later pending findings by the length delta. */
export function applyOne(
  text: string,
  findings: Finding[],
  id: string,
  suggestionOverride?: string,
): { text: string; findings: Finding[] } {
  const target = findings.find(f => f.id === id)
  if (!target || target.status !== 'pending') return { text, findings }

  let start = target.char_start
  let end = target.char_end
  if (!verify(text, target)) {
    const moved = relocate(text, target)
    if (!moved) {
      return {
        text,
        findings: findings.map(f => (f.id === id ? { ...f, status: 'stale' } : f)),
      }
    }
    start = moved.char_start
    end = moved.char_end
  }

  const replacement = suggestionOverride ?? target.suggestion
  const nextText = splice(text, start, end, replacement)
  const delta = replacement.length - (end - start)

  const nextFindings = findings.map(f => {
    if (f.id === id) return { ...f, status: 'applied' as const }
    if (f.status === 'pending' && f.char_start >= end) {
      return { ...f, char_start: f.char_start + delta, char_end: f.char_end + delta }
    }
    return f
  })
  return { text: nextText, findings: nextFindings }
}

/** Apply every pending finding, highest offset first so earlier spans stay
 *  valid without recomputation. */
export function applyAll(text: string, findings: Finding[]): { text: string; findings: Finding[] } {
  const pending = findings.filter(f => f.status === 'pending').sort((a, b) => b.char_start - a.char_start)
  let out = text
  const done = new Set<string>()
  for (const f of pending) {
    if (verify(out, f)) {
      out = splice(out, f.char_start, f.char_end, f.suggestion)
      done.add(f.id)
    } else {
      const moved = relocate(out, f)
      if (moved) {
        out = splice(out, moved.char_start, moved.char_end, f.suggestion)
        done.add(f.id)
      }
    }
  }
  const nextFindings = findings.map(f =>
    done.has(f.id) ? { ...f, status: 'applied' as const } : f,
  )
  return { text: out, findings: nextFindings }
}

/** Keep the first finding in document order from any overlapping group. */
export function dropOverlaps(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => a.char_start - b.char_start || a.char_end - b.char_end)
  const kept: Finding[] = []
  let lastEnd = -1
  for (const f of sorted) {
    if (f.char_start >= lastEnd) {
      kept.push(f)
      lastEnd = f.char_end
    }
  }
  return kept
}
