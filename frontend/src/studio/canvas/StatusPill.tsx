import { type CanvasStatus, STATUS_LABEL } from './canvasData'

/** The pipeline-enum pill — the only place Canvas status color is spent. */
export function StatusPill({ status }: { status: CanvasStatus }) {
  return (
    <span className={`ppc-pill st-${status}`}>
      <span className="ppc-pill__dot" />
      {STATUS_LABEL[status]}
    </span>
  )
}
