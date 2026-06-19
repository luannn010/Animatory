import type { ReactNode } from 'react'

// Animation-tool iconography for the Rig Studio — local 24-box SVG glyphs
// (currentColor), kept out of the shared lucide Icon set.
export function Glyph({ d, size = 16, fill = false }: { d: ReactNode; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>{d}</svg>
  )
}

export const GLYPH: Record<string, ReactNode> = {
  cursor: <path d="M5 3l6 16 2.5-6.5L20 10z" />,
  move: <><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>,
  hand: <path d="M8 11V6a1.5 1.5 0 0 1 3 0v4V4.5a1.5 1.5 0 0 1 3 0V10V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.6 1.6 0 0 1 2.4-2.1L8 12" />,
  zoom: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></>,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  comment: <path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-5A8 8 0 1 1 21 12z" />,
  fx: <><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19" /><circle cx="12" cy="12" r="3.2" /></>,
  script: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  first: <><path d="M7 5v14" /><path d="M19 5 9 12l10 7z" fill="currentColor" stroke="none" /></>,
  last: <><path d="M17 5v14" /><path d="M5 5l10 7L5 19z" fill="currentColor" stroke="none" /></>,
  prevf: <path d="M14 5 7 12l7 7z" fill="currentColor" stroke="none" />,
  nextf: <path d="M10 5l7 7-7 7z" fill="currentColor" stroke="none" />,
  prevk: <><path d="M6 5v14" /><path d="M17 5 9 12l8 7z" fill="currentColor" stroke="none" /></>,
  nextk: <><path d="M18 5v14" /><path d="M7 5l8 7-8 7z" fill="currentColor" stroke="none" /></>,
  minus: <path d="M5 12h14" />,
}
