// frontend/src/components/transcriptMetrics.ts
//
// Pure, browser-side helpers for the upload preview: size, word/char counts,
// and a lightweight language guess from a quick skim of the text. No network,
// no dependencies — kept separate from the component so it is unit-testable.

export interface TranscriptMetrics {
  sizeBytes: number
  sizeLabel: string
  wordCount: number
  charCount: number
  /** Heuristic guess — always treat as approximate, never authoritative. */
  language: string
}

/** Human-readable file size: B under 1 KiB, then KB, then MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** Whitespace-delimited word count, matching the chunker's notion of a word. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

const VIET_SPECIFIC = 'ăâđêôơưĂÂĐÊÔƠƯ'

/**
 * Best-effort language guess from the first few thousand characters. Counts
 * letters by script and picks the dominant one; Vietnamese is distinguished
 * from other Latin-script text by its diacritics. Returns a display label.
 */
export function detectLanguage(text: string): string {
  const sample = text.slice(0, 4000)
  let latin = 0
  let viet = 0
  let han = 0
  let kana = 0
  let hangul = 0
  let cyrillic = 0
  let arabic = 0

  for (const ch of sample) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x1ea0 && c <= 0x1eff) || VIET_SPECIFIC.includes(ch)) {
      viet++
      latin++
    } else if (
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0xc0 && c <= 0x24f) // Latin-1 supplement + Latin Extended-A/B
    ) {
      latin++
    } else if (c >= 0x4e00 && c <= 0x9fff) {
      han++
    } else if (c >= 0x3040 && c <= 0x30ff) {
      kana++
    } else if (c >= 0xac00 && c <= 0xd7af) {
      hangul++
    } else if (c >= 0x400 && c <= 0x4ff) {
      cyrillic++
    } else if (c >= 0x600 && c <= 0x6ff) {
      arabic++
    }
  }

  const cjk = han + kana + hangul
  if (cjk > 0 && cjk >= latin) {
    if (hangul > 0) return 'Korean'
    if (kana > 0) return 'Japanese'
    return 'Chinese'
  }
  if (cyrillic > 0 && cyrillic >= latin) return 'Russian / Cyrillic'
  if (arabic > 0 && arabic >= latin) return 'Arabic'
  if (latin === 0) return 'Unknown'
  if (viet / latin > 0.01) return 'Vietnamese'
  return 'English / Latin'
}

/** Compute the full preview metric set from file text + its byte size. */
export function computeMetrics(text: string, sizeBytes: number): TranscriptMetrics {
  return {
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    wordCount: countWords(text),
    charCount: text.length,
    language: detectLanguage(text),
  }
}
