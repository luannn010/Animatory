// frontend/src/spellcheck/types.ts

/** A finding exactly as it arrives over the WebSocket (global offsets). */
export interface RawFinding {
  type: 'spelling' | 'grammar' | 'naming'
  original: string
  suggestion: string
  char_start: number
  char_end: number
  reason: string
}

/** A finding tracked in the UI: raw fields + identity + lifecycle. */
export interface Finding extends RawFinding {
  id: string
  status: 'pending' | 'applied' | 'stale'
}
