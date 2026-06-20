import { SectionLabel, Button } from '@animatory/ui'

export const Basic = () => (
  <div className="w-96">
    <SectionLabel icon="user" count={6}>Characters</SectionLabel>
  </div>
)

export const WithAction = () => (
  <div className="w-96">
    <SectionLabel
      icon="map-pin"
      count={3}
      action={<Button variant="ghost" size="sm" icon="plus">Add location</Button>}
    >
      Locations
    </SectionLabel>
  </div>
)
