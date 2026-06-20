import { ProgressBar } from '@animatory/ui'

export const Tones = () => (
  <div className="flex w-80 flex-col gap-4">
    <ProgressBar value={3} max={10} tone="active" />
    <ProgressBar value={7} max={10} tone="ready" />
    <ProgressBar value={2} max={10} tone="warning" />
  </div>
)

export const Thin = () => (
  <div className="w-80">
    <ProgressBar value={6} max={12} tone="active" thin />
  </div>
)
