import { Icon, type IconName } from '@animatory/ui'

const NAMES: IconName[] = [
  'film', 'user', 'map-pin', 'package', 'sparkles', 'image', 'mic', 'volume-2',
  'play', 'pause', 'layers', 'grid', 'eye', 'lock', 'clock', 'download',
]

export const Gallery = () => (
  <div className="flex max-w-md flex-wrap items-center gap-4 text-steel">
    {NAMES.map((n) => <Icon key={n} name={n} size={20} />)}
  </div>
)

export const Sizes = () => (
  <div className="flex items-center gap-4 text-ink">
    <Icon name="sparkles" size={16} />
    <Icon name="sparkles" size={24} />
    <Icon name="sparkles" size={32} />
  </div>
)
