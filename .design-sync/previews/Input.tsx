import { Input } from '@animatory/ui'

export const WithLabels = () => (
  <div className="flex w-80 flex-col gap-4">
    <Input label="Project name" placeholder="e.g. The Lantern Festival" />
    <Input label="Episode title" defaultValue="Chapter 1 — The Arrival" />
  </div>
)

export const Plain = () => (
  <div className="w-80">
    <Input placeholder="Search scenes…" />
  </div>
)

export const Disabled = () => (
  <div className="w-80">
    <Input label="Render seed (locked)" defaultValue="48172" disabled />
  </div>
)
