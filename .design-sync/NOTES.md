# design-sync notes — Animatory UI

Scope: the **studio/ui primitives** only (`frontend/src/studio/ui/index.ts` barrel,
15 components). Project: `@animatory/ui` → `window.AnimatoryUI`. Shape: `package`.

## This repo is an app, not a DS package (off-envelope build)

Animatory has no publishable component package and no built `dist/` — it's a Vite app
whose CSS is Tailwind-generated at build time. So the converter's inputs are regenerated
by **`cfg.buildCmd` = `node .design-sync/build/run.mjs`** (committed). It produces, all
into gitignored dirs:

- `frontend/.design-sync-build/dist/index.mjs` — esbuild of the barrel (jsx automatic;
  react/react-dom/lucide-react external). This is `cfg.entry` (the runtime bundle source).
- `frontend/.design-sync-build/styles.css` — Tailwind compiled from the real
  `tailwind.config.js` theme + `src/studio/kit.css`, with a **safelist** of Animatory
  semantic tokens. This is `cfg.cssEntry` (copied verbatim into `_ds_bundle.css`).
- `frontend/.design-sync-build/inter.css` + `fonts/*.woff2` — `cfg.extraFonts`.
- `frontend/build/ts/**.d.ts` + `frontend/build/ts/package.json` — tsc declarations.

**Re-sync = one command after `buildCmd`:** read this file → re-copy `.ds-sync/` →
`node .design-sync/build/run.mjs` → `node .ds-sync/resync.mjs --config … --node-modules ./frontend/node_modules --entry ./frontend/.design-sync-build/dist/index.mjs --out ./ds-bundle --remote …`.

## Why the `build/ts/package.json` trick (don't remove it)

The runtime entry is a type-stripped `.mjs`, so the converter extracts props from the
tsc `.d.ts` tree. `findTypesRoot` only finds `build/ts` if it exists; `loadDts` then needs
a named `package.json` there pointing `types` at the barrel `.d.ts` — without it,
**inline-typed** components (Pill, ProgressBar, Icon, StageBadge, Input, Textarea, Chip,
ReadinessDot, BackLink, SectionLabel, TrackHeaderStrip — most of them) fall back to
`[key:string]: unknown`. `run.mjs` writes that package.json. Only Button/IconButton/Card
have named `<Name>Props` interfaces and would extract without it.

## Worktree note

`frontend/node_modules` here is a junction to the main checkout's install (fast). The
font extractor realpaths through it; that's why Inter is materialized **inside** the
worktree (`run.mjs` copies the woff2) rather than referenced from node_modules.

## Brand-font finding (likely an app bug — flagged to the user)

Components reference family **`InterVariable`** (tailwind `sans`, `index.css` html) but
`@fontsource-variable/inter` registers **`'Inter Variable'`** (with a space). Neither that
nor the bare `Inter` fallback matches → the **app itself likely renders in the system
font**, not Inter. The synced DS aliases the @font-face to both `InterVariable` and `Inter`
so the brand font renders. If the app's font setup is fixed, this aliasing can be revisited.

**Geist Mono** (`font-mono`) is referenced but never installed — falls back to system mono
in the app too. Suppressed via `cfg.runtimeFontPrefixes: ["Geist Mono"]`. Not a bug to fix.

## Grouping

Semantic groups via `cfg.docsMap` → `.design-sync/groups/{controls,feedback,layout,media}.md`
category stubs. Controls: Button, IconButton, Chip, Input, Textarea · Feedback: Pill,
StageBadge, ReadinessDot, ProgressBar · Layout: Card, TrackHeaderStrip, SectionLabel,
BackLink · Media: Icon, PlateThumb.

## Known render warns (triaged — re-syncs should not treat as new)

- **`[RENDER_THIN]` on Icon** — benign. The Gallery/Sizes cells are pure-SVG (lucide) with
  no text nodes, so the "no text + paints nothing" heuristic misfires. Visually confirmed:
  `_screenshots/review/media__Icon.png` shows all 16 glyphs rendering. Do not rework.
- `[GRID_OVERFLOW]` was resolved by `cfg.overrides.{TrackHeaderStrip,SectionLabel,Textarea}:
  {cardMode: column}` (they're wide/full-width). Column cards can't re-flag.
- `tokens: 1 missing (below threshold)` — non-blocking; a Tailwind-internal var.

## Re-sync risks (watch-list)

- **`run.mjs` reads `src/studio/kit.css` and `tailwind.config.js`** — if the app changes
  its tokens or kit animations, re-run to pick them up (it does, automatically).
- **Component API drift**: if a primitive's props change, the `.d.ts` re-extracts on
  rebuild (good), but re-grade its preview if appearance changes.
- **Inter aliasing** is tied to the app's font-name mismatch above; if the app fixes its
  font setup, revisit `inter.css` generation in `run.mjs`.
- **Playwright/chromium** must be present for the render check (install: `cd .ds-sync &&
  npm i playwright && ./node_modules/.bin/playwright install chromium`).
- **`.d.ts` parse check** is skipped (no `typescript` in `.ds-sync`); the `.d.ts` are
  tsc-emitted so they're valid, but to enable it: `npm i typescript` in `.ds-sync`.
- Upload requires a claude.ai login with design scopes (`/login`); the SDK OAuth token
  can't be expanded with them.
