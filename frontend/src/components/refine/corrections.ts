// frontend/src/components/refine/corrections.ts
import type { TextCorrection } from '../../api/pipeline'

/** True if the correction's `find` still appears in the text. */
export function correctionMatches(text: string, c: TextCorrection): boolean {
  return c.find.length > 0 && text.includes(c.find)
}

/** Apply one correction to the text (first or all occurrences). Plain string
 *  replacement — `find` is treated literally, never as a regex. */
export function applyCorrection(text: string, c: TextCorrection): string {
  if (!correctionMatches(text, c)) return text
  if (c.all_occurrences) return text.split(c.find).join(c.replace)
  return text.replace(c.find, c.replace)
}
