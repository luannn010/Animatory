import { IconButton } from '@animatory/ui'

export const Actions = () => (
  <div className="flex flex-wrap items-center gap-2">
    <IconButton icon="play" label="Play" />
    <IconButton icon="pause" label="Pause" />
    <IconButton icon="refresh" label="Re-run" />
    <IconButton icon="download" label="Download" />
    <IconButton icon="more-horizontal" label="More actions" />
  </div>
)

export const Sizes = () => (
  <div className="flex items-center gap-2">
    <IconButton icon="pencil" label="Edit" size="sm" />
    <IconButton icon="pencil" label="Edit" size="md" />
  </div>
)
