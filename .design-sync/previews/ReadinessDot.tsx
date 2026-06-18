import { ReadinessDot } from '@animatory/ui'

export const Statuses = () => (
  <div className="flex items-center gap-6 text-sm text-ink">
    <span className="inline-flex items-center gap-2"><ReadinessDot status="idle" /> Idle</span>
    <span className="inline-flex items-center gap-2"><ReadinessDot status="active" /> Active</span>
    <span className="inline-flex items-center gap-2"><ReadinessDot status="ready" /> Ready</span>
  </div>
)
