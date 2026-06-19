// Shared studio UI primitives — Tailwind + design tokens, one accent (#3772cf),
// restrained motion. Ported from the Animatory design system's core components.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import type { DesignStage } from '../types'

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3772cf]'

// ── Button ───────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-[#3772cf] text-white hover:bg-[#2c5cab] disabled:hover:bg-[#3772cf]',
  secondary: 'border border-hairline bg-canvas text-ink hover:bg-surface',
  ghost: 'text-steel hover:bg-surface hover:text-ink',
}
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  block?: boolean
}

export function Button({
  variant = 'secondary', size = 'md', icon, iconRight, loading, block,
  children, className = '', disabled, ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${ring} ${className}`}
      {...rest}
    >
      {loading ? <span className="anmt-spinner" /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  )
}

// ── IconButton ───────────────────────────────────────────────────────────────

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  size?: 'sm' | 'md'
}

export function IconButton({ icon, label, size = 'md', className = '', ...rest }: IconButtonProps) {
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'
  return (
    <button
      aria-label={label} title={label}
      className={`grid place-items-center rounded-md border border-hairline bg-canvas text-steel hover:text-ink hover:bg-surface transition-colors active:scale-[0.94] disabled:opacity-50 ${dim} ${ring} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 15 : 17} />
    </button>
  )
}

// ── Pill ─────────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'idle' | 'active' | 'ready' | 'warning' | 'error'

const TONE: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: 'bg-surface text-steel', dot: 'bg-stone' },
  idle:    { pill: 'bg-surface text-stone', dot: 'bg-stone' },
  active:  { pill: 'bg-[#3772cf]/10 text-[#3772cf]', dot: 'bg-[#3772cf]' },
  ready:   { pill: 'bg-[#00b48a]/10 text-[#00b48a]', dot: 'bg-[#00b48a]' },
  warning: { pill: 'bg-brand-warn/10 text-brand-warn', dot: 'bg-brand-warn' },
  error:   { pill: 'bg-brand-error/10 text-brand-error', dot: 'bg-brand-error' },
}

export function Pill({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone].pill}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

// ── Chip (toggle) ────────────────────────────────────────────────────────────

export function Chip({ selected, onClick, children }: { selected?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick} aria-pressed={selected}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${ring} ${
        selected ? 'border-[#3772cf] bg-[#3772cf]/10 text-[#3772cf]' : 'border-hairline text-steel hover:bg-surface'
      }`}
    >
      {children}
    </button>
  )
}

// ── StageBadge ───────────────────────────────────────────────────────────────

const STAGE: Record<DesignStage, { label: string; cls: string; dot: string }> = {
  rough:    { label: 'Rough',     cls: 'bg-surface text-stone',          dot: 'bg-stone' },
  color:    { label: 'Color',     cls: 'bg-[#3772cf]/10 text-[#3772cf]', dot: 'bg-[#3772cf]' },
  locked:   { label: 'Locked',    cls: 'bg-[#00b48a]/10 text-[#00b48a]', dot: 'bg-[#00b48a]' },
}

export function StageBadge({ stage }: { stage: DesignStage }) {
  const s = STAGE[stage]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  )
}

// ── ReadinessDot ─────────────────────────────────────────────────────────────

const READY: Record<'idle' | 'active' | 'ready', string> = {
  idle: 'bg-hairline', active: 'bg-[#3772cf] anmt-dot--active', ready: 'bg-[#00b48a]',
}

export function ReadinessDot({ status }: { status: 'idle' | 'active' | 'ready' }) {
  return <span className={`w-1.5 h-1.5 rounded-full ${READY[status]}`} aria-hidden="true" />
}

// ── ProgressBar ──────────────────────────────────────────────────────────────

const FILL: Record<Tone, string> = {
  neutral: 'bg-stone', idle: 'bg-stone', active: 'bg-[#3772cf]',
  ready: 'bg-[#00b48a]', warning: 'bg-brand-warn', error: 'bg-brand-error',
}

export function ProgressBar({ value, max, tone = 'active', thin }: { value: number; max: number; tone?: Tone; thin?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={`w-full rounded-full bg-hairline overflow-hidden ${thin ? 'h-1' : 'h-1.5'}`} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${FILL[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  interactive?: boolean
  selected?: boolean
  flush?: boolean
  className?: string
  onClick?: () => void
  children: ReactNode
}

export function Card({ interactive, selected, flush, className = '', onClick, children }: CardProps) {
  const base = 'rounded-lg border bg-canvas transition-[transform,border-color,box-shadow] duration-200'
  const state = selected
    ? 'border-[#3772cf] ring-2 ring-[#3772cf]/30'
    : interactive
      ? 'border-hairline hover:border-[#3772cf]/50 hover:-translate-y-0.5 hover:shadow-card cursor-pointer'
      : 'border-hairline'
  return (
    <div
      className={`${base} ${state} ${flush ? '' : 'p-4'} ${className} ${interactive ? ring : ''}`}
      onClick={onClick}
      {...(interactive && onClick ? { role: 'button', tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } } : {})}
    >
      {children}
    </div>
  )
}

// ── Input / Textarea ─────────────────────────────────────────────────────────

const ctl = `w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-stone ${ring}`

export function Input({ label, ...rest }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-[10px] font-medium uppercase tracking-wider text-stone">{label}</span>}
      <input className={ctl} {...rest} />
    </label>
  )
}

export function Textarea({ label, ...rest }: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-[10px] font-medium uppercase tracking-wider text-stone">{label}</span>}
      <textarea className={`${ctl} resize-y leading-relaxed`} {...rest} />
    </label>
  )
}
