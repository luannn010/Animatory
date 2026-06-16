// Thin wrapper over lucide-react: a curated name map + the brand's stroke
// defaults (1.75, round caps via lucide). Keeps call-sites terse and the icon
// set closed, matching the design system's Icon component.
import {
  Film, Search, User, MapPin, Package, Sparkles, RefreshCw, Upload, Lock,
  Play, Pause, Image, Mic, Volume2, ChevronRight, ChevronDown, ArrowRight,
  Check, X, Plus, Clock, Printer, Download, Eye, MoreHorizontal, Pencil,
  Layers, Grid3x3, type LucideIcon,
} from 'lucide-react'

const MAP = {
  film: Film, search: Search, user: User, 'map-pin': MapPin, package: Package,
  sparkles: Sparkles, refresh: RefreshCw, upload: Upload, lock: Lock,
  play: Play, pause: Pause, image: Image, mic: Mic, 'volume-2': Volume2,
  'chevron-right': ChevronRight, 'chevron-down': ChevronDown, 'arrow-right': ArrowRight,
  check: Check, x: X, plus: Plus, clock: Clock, printer: Printer, download: Download,
  eye: Eye, 'more-horizontal': MoreHorizontal, pencil: Pencil, layers: Layers, grid: Grid3x3,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof MAP

interface Props {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ name, size = 18, className, strokeWidth = 1.75 }: Props) {
  const Glyph = MAP[name]
  return <Glyph size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
}
