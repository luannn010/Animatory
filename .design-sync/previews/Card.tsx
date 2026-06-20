import { Card, Pill } from '@animatory/ui'

export const Basic = () => (
  <div className="w-80">
    <Card>
      <h3 className="text-sm font-semibold text-ink">Scene 12 — Courtyard</h3>
      <p className="mt-1 text-sm text-stone">Establishing shot, dusk lighting, two characters.</p>
    </Card>
  </div>
)

export const Interactive = () => (
  <div className="w-80">
    <Card interactive>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Character: Mai</h3>
        <Pill tone="ready" dot>Locked</Pill>
      </div>
      <p className="mt-1 text-sm text-stone">Lead. 3 expressions, 2 outfits approved.</p>
    </Card>
  </div>
)

export const Selected = () => (
  <div className="w-80">
    <Card selected>
      <h3 className="text-sm font-semibold text-ink">Selected card</h3>
      <p className="mt-1 text-sm text-stone">Shows the accent ring and border.</p>
    </Card>
  </div>
)
