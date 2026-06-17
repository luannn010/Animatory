// Minimal scaffold placeholder — proves a /pre route + its params + data wiring
// render. Replaced by the real page when its design handoff lands. Token-only.
interface Props {
  name: string
  params: Record<string, string>
  data?: string | null   // a non-zero count proving the facade read worked
}

export function Placeholder({ name, params, data }: Props) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas p-5">
      <div className="text-[11px] uppercase tracking-wider font-mono text-[#3772cf] mb-2">Scaffold placeholder</div>
      <h2 className="text-sm font-semibold text-ink mb-3">{name}</h2>
      <dl className="text-xs space-y-1">
        {Object.entries(params).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="text-steel w-20 shrink-0">{k}</dt>
            <dd className="font-mono text-ink">{v || '—'}</dd>
          </div>
        ))}
        <div className="flex gap-2">
          <dt className="text-steel w-20 shrink-0">data</dt>
          <dd className="text-ink">{data ?? <span className="text-stone">loading…</span>}</dd>
        </div>
      </dl>
    </div>
  )
}
