## Building with Animatory UI

Animatory UI is the design system for a 2D-animation production studio. 15 prop-driven
React primitives. **One accent — `#3772cf` (Animatory blue); status colors are semantic,
never decorative.** The look is restrained: hairline borders, one accent, subtle motion.

### Setup — no provider needed

These primitives are self-contained: there is **no ThemeProvider, context, or wrapper**.
Just import and render.

```tsx
import { Button, Card, Pill } from '@animatory/ui'   // bundle: window.AnimatoryUI
```

Load the **single stylesheet `styles.css`** once at the app root — it `@import`s the
fonts (Inter, incl. Vietnamese) and the compiled token + component CSS. Without it,
components render unstyled. Don't import per-component CSS; there is only `styles.css`.

### Style through PROPS, not class overrides

The design language lives in the props — reach for these before any custom CSS:

- **Button** — `variant: "primary" | "secondary" | "ghost"`, `size: "sm" | "md" | "lg"`, `icon`, `iconRight`, `loading`, `block`
- **IconButton** — `icon`, `label` (required, a11y), `size`
- **Pill**, **ProgressBar** — `tone: "neutral" | "idle" | "active" | "ready" | "warning" | "error"`
- **StageBadge** — `stage: "rough" | "bw_final" | "color" | "locked"`
- **ReadinessDot** — `status: "idle" | "active" | "ready"`
- **Card** — `interactive`, `selected`, `flush`
- **Icon** — `name` from a closed set (`film`, `user`, `map-pin`, `sparkles`, `play`, `lock`, `download`, … see `Icon.d.ts`), `size`
- **Chip** — `selected`, `onClick`; **Input** / **Textarea** — `label`; **BackLink** — `onClick`
- **SectionLabel** — `icon`, `count`, `action`; **TrackHeaderStrip** — `title`, `sub`, `done`, `total`, `unit`, `tone`, `action`; **PlateThumb** — `id`, `kind`, `ratio`, `locked`, `empty`

### Utility vocabulary (for your own layout glue)

Use Tailwind utilities with the Animatory tokens that ship in `styles.css`:

| Family | Real names |
|---|---|
| Color `bg-/text-/border-/ring-` | `canvas` `surface` `surface-soft` `ink` `charcoal` `slate` `steel` `stone` `muted` `hairline` `paper` · accent `brand-tag` (=`#3772cf`) · status `brand-green-deep` `brand-warn` `brand-error` · `stage-rough/-bw/-color/-locked` |
| Spacing `gap-/p*/m*` | named `xxs xs sm md lg xl xxl xxxl` + the default Tailwind scale (`gap-3`, `p-4`) |
| Radius / Shadow | `rounded-{xs,sm,md,lg,xl,xxl,full}` · `shadow-{subtle,card,mockup}` |
| Type | `font-sans` (Inter, default) · `font-mono` (for IDs / counts / code) |

The accent is also usable as the literal arbitrary value (`bg-[#3772cf]`, `text-[#3772cf]`,
`ring-[#3772cf]`) — but prefer component props, and `brand-tag` for glue. Only classes
present in `styles.css` render — stay within this vocabulary rather than inventing utilities.

### Where the truth lives

Read **`styles.css`** (and its `@import` of `_ds_bundle.css`, where every `--token` and
component rule lives) before styling, and each component's **`.d.ts`** (props) and
**`.prompt.md`** (usage) before composing it.

### Idiomatic example

```tsx
import { Card, Pill, Button, SectionLabel } from '@animatory/ui'

function CharacterPanel() {
  return (
    <section className="flex flex-col gap-md">
      <SectionLabel icon="user" count={6}>Characters</SectionLabel>
      <Card interactive>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Mai</h3>
          <Pill tone="ready" dot>Locked</Pill>
        </div>
        <p className="mt-1 text-sm text-stone">Lead · 3 expressions, 2 outfits approved.</p>
        <Button variant="primary" size="sm" icon="pencil" className="mt-3">Edit</Button>
      </Card>
    </section>
  )
}
```
