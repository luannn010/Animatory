import type { AgentSchema } from '../../types'

interface Props { agent: AgentSchema }

export function OverviewTab({ agent }: Props) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-1">Role</p>
        <p className="text-charcoal">{agent.role}</p>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-1">Responsibility</p>
        <p className="text-charcoal leading-relaxed">{agent.responsibility}</p>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Inputs</p>
          <ul className="space-y-1">
            {agent.inputs.map(io => (
              <li key={io.name} className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-xs text-charcoal">{io.name}</span>
                <span className="font-mono text-[10px] text-stone">{io.type}</span>
                {io.required && (
                  <span className="text-[9px] font-semibold uppercase px-1 py-px rounded bg-[#d45656]/15 text-[#d45656]">req</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Outputs</p>
          <ul className="space-y-1">
            {agent.outputs.map(io => (
              <li key={io.name} className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-charcoal">{io.name}</span>
                <span className="font-mono text-[10px] text-stone">{io.type}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {agent.acceptance.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Acceptance Criteria</p>
          <ul className="space-y-1">
            {agent.acceptance.map(a => (
              <li key={a} className="flex items-start gap-2 text-xs text-steel">
                <span className="text-[#00d4a4] mt-px shrink-0">✓</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel mb-2">Config</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-stone">Timeout</dt>       <dd className="text-charcoal font-mono">{agent.timeout_s}s</dd>
          <dt className="text-stone">Retries</dt>       <dd className="text-charcoal font-mono">{agent.retry.max_attempts}</dd>
          <dt className="text-stone">Backoff</dt>       <dd className="text-charcoal font-mono">{agent.retry.backoff}</dd>
          <dt className="text-stone">Cost est.</dt>     <dd className="text-charcoal font-mono">{agent.cost_estimate}</dd>
          <dt className="text-stone">Idempotent</dt>    <dd className="text-charcoal font-mono">{agent.idempotent ? 'yes' : 'no'}</dd>
          <dt className="text-stone">Trigger</dt>       <dd className="text-charcoal font-mono">{agent.trigger}</dd>
        </dl>
      </section>
    </div>
  )
}
