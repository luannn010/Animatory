import { PlateThumb } from '@animatory/ui'

export const Kinds = () => (
  <div className="flex items-end gap-4">
    <div className="w-32"><PlateThumb id="mai-lead" kind="character" ratio="3 / 4" /></div>
    <div className="w-32"><PlateThumb id="courtyard-01" kind="location" ratio="3 / 4" /></div>
    <div className="w-32"><PlateThumb id="lantern-prop" kind="prop" ratio="3 / 4" /></div>
  </div>
)

export const LockedAndEmpty = () => (
  <div className="flex items-end gap-4">
    <div className="w-32"><PlateThumb id="hero-final" kind="character" ratio="1 / 1" locked /></div>
    <div className="w-32"><PlateThumb id="empty-slot" kind="prop" ratio="1 / 1" empty label="No art yet" /></div>
  </div>
)
