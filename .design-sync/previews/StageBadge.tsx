import { StageBadge } from '@animatory/ui'

export const Stages = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StageBadge stage="rough" />
    <StageBadge stage="bw_final" />
    <StageBadge stage="color" />
    <StageBadge stage="locked" />
  </div>
)
