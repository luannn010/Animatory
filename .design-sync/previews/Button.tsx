import { Button } from '@animatory/ui'

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary">Generate scene</Button>
    <Button variant="secondary">Re-run</Button>
    <Button variant="ghost">Cancel</Button>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" size="sm">Small</Button>
    <Button variant="primary" size="md">Medium</Button>
    <Button variant="primary" size="lg">Large</Button>
  </div>
)

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" icon="sparkles">Generate</Button>
    <Button variant="secondary" icon="refresh">Retry</Button>
    <Button variant="secondary" iconRight="arrow-right">Next step</Button>
    <Button variant="ghost" icon="download">Export</Button>
  </div>
)

export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" loading>Rendering…</Button>
    <Button variant="primary" disabled>Disabled</Button>
    <Button variant="secondary" icon="lock" disabled>Locked</Button>
  </div>
)
