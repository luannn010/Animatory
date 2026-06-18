import { Pill } from '@animatory/ui'

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Pill tone="neutral" dot>Draft</Pill>
    <Pill tone="active" dot>Rendering</Pill>
    <Pill tone="ready" dot>Approved</Pill>
    <Pill tone="warning" dot>Needs review</Pill>
    <Pill tone="error" dot>Failed</Pill>
  </div>
)

export const WithoutDot = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Pill tone="active">v3</Pill>
    <Pill tone="neutral">1080p</Pill>
    <Pill tone="ready">Locked</Pill>
  </div>
)
