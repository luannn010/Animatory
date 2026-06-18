import { Chip } from '@animatory/ui'

export const Filters = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Chip selected>All scenes</Chip>
    <Chip>Characters</Chip>
    <Chip>Locations</Chip>
    <Chip>Props</Chip>
  </div>
)

export const States = () => (
  <div className="flex items-center gap-2">
    <Chip>Unselected</Chip>
    <Chip selected>Selected</Chip>
  </div>
)
