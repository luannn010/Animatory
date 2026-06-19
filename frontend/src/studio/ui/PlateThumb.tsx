// Honest stand-in for generated/locked art: a deterministic dark gradient plate
// (seeded from the id) + the asset-kind glyph. Never fake artwork. Mirrors the
// design system's PlateThumb. `empty` shows a dashed hatch instead.
import { Icon, type IconName } from './Icon'
import type { DesignKind } from '../types'

const KIND_ICON: Record<DesignKind, IconName> = {
  character: 'user', location: 'map-pin', prop: 'package',
}

// Deterministic hue from the id → a calm dark gradient (matches the design).
function plateColors(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return { a: `hsl(${h} 42% 30%)`, b: `hsl(${(h + 36) % 360} 38% 18%)` }
}

interface Props {
  id: string
  kind?: DesignKind
  ratio?: string          // CSS aspect-ratio, e.g. "3 / 4"
  locked?: boolean
  empty?: boolean
  label?: string
  className?: string
  src?: string            // real generated art — shown instead of the placeholder plate
  alt?: string
}

export function PlateThumb({ id, kind = 'character', ratio = '1 / 1', locked, empty, label, className = '', src, alt }: Props) {
  if (src && !empty) {
    return (
      <div className={`relative overflow-hidden rounded-[inherit] bg-surface ${className}`} style={{ aspectRatio: ratio }}>
        <img src={src} alt={alt ?? ''} className="h-full w-full object-cover" />
        {locked && (
          <span className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            <Icon name="lock" size={11} /> Locked
          </span>
        )}
      </div>
    )
  }
  if (empty) {
    return (
      <div
        className={`plate-hatch relative grid place-items-center gap-1.5 rounded-[inherit] border border-dashed border-hairline text-stone ${className}`}
        style={{ aspectRatio: ratio }}
      >
        <Icon name={KIND_ICON[kind]} size={24} />
        {label && <span className="text-[10px] uppercase tracking-wider">{label}</span>}
      </div>
    )
  }
  const c = plateColors(id)
  return (
    <div
      className={`relative grid place-items-center overflow-hidden rounded-[inherit] text-white/80 ${className}`}
      style={{ aspectRatio: ratio, backgroundImage: `linear-gradient(150deg, ${c.a}, ${c.b})` }}
    >
      <Icon name={KIND_ICON[kind]} size={22} className="opacity-85" />
      {locked && (
        <span className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          <Icon name="lock" size={11} /> Locked
        </span>
      )}
    </div>
  )
}
