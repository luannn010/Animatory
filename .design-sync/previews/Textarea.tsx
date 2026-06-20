import { Textarea } from '@animatory/ui'

export const WithLabel = () => (
  <div className="w-96">
    <Textarea
      label="Scene description"
      rows={4}
      defaultValue="A lantern-lit courtyard at dusk; two figures meet by the well as paper lanterns drift overhead."
    />
  </div>
)

export const Empty = () => (
  <div className="w-96">
    <Textarea label="Director notes" placeholder="Add notes for the animation team…" rows={3} />
  </div>
)
