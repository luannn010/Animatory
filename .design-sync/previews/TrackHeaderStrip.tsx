import { TrackHeaderStrip, Button } from '@animatory/ui'

export const InProgress = () => (
  <TrackHeaderStrip
    title="Character Design"
    sub="Lock every hero and supporting character before animation."
    done={7}
    total={12}
    unit="locked"
    action={<Button variant="primary" size="sm" icon="plus">New character</Button>}
  />
)

export const Complete = () => (
  <TrackHeaderStrip
    title="Location Design"
    sub="All backgrounds approved and color-locked."
    done={9}
    total={9}
    unit="locked"
  />
)

export const EarlyStage = () => (
  <TrackHeaderStrip
    title="Prop Design"
    sub="Reference sheets for the recurring props in this episode."
    done={1}
    total={8}
    unit="locked"
    tone="active"
  />
)
