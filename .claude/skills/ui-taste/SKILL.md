---
name: ui-taste
description: Use when building, modifying, or reviewing any Animatory frontend UI (studio views, components, Tailwind markup) — before writing JSX and before calling UI work done.
---

# UI Taste — Animatory

## Overview

Generic "AI-slop" UI is the default failure mode: centered everything, emoji as
icons, three gradients, inconsistent radii, `gap-4` everywhere, no real states.
This skill is the bar that keeps Animatory looking designed, not generated.

**Core principle: restraint over decoration. Every visual choice must earn its place.**

The design specs in `docs/superpowers/specs/` are the source of truth for *what*
to build. This skill governs *how it looks*.

## Non-negotiable rules

1. **One accent, period.** Studio accent is `#3772cf`. Status colors
   (`#00b48a` done, `#c37d0d` warn, `#d45656` error, `#7c3aed` parse) are
   *semantic only* — never decorative. No second "nice" blue, no purple buttons.
2. **Use the token scale, never raw values.** Spacing, radius, and color come
   from `tailwind.config.js` (`surface`/`canvas`/`hairline`/`ink`/`steel`/`stone`,
   radius `xs|sm|md|lg`). An arbitrary `p-[13px]` or `#f3f4f6` is a bug.
3. **Gradients are for thumbnails only.** Flat surfaces everywhere else. The
   teal header gradient is the single exception (it predates the studio).
4. **Emoji are placeholders, not iconography.** Current mock cards use emoji —
   treat them as TODO. Never add *new* emoji to chrome (nav, buttons, headers).
5. **Left-align by default.** Center only genuinely centered things (empty
   states, a lone modal). Dashboards and lists are left-aligned.
6. **Real states, always.** Every list/fetch view needs loading (skeleton, not
   a spinner), empty (a sentence + the next action), and error. No bare spinners.
7. **Motion is fast and few.** Transitions 120–180ms on color/opacity/transform
   only. No animating layout, no bounce, no entrance animations on lists.
8. **Type hierarchy by weight + color, not size soup.** Lean on `font-medium`/
   `font-semibold` and `ink`/`steel`/`stone`. At most 2–3 sizes per screen.
9. **Accessible by default.** Interactive elements keep a visible focus ring
   (`focus-visible:ring-2 focus-visible:ring-[#3772cf]`), meet WCAG AA contrast
   (white text needs a dark-enough accent — `#3772cf` passes, light tints do
   not), and an icon-only control gets an `aria-label`. Taste includes a11y.
10. **Controls reflect their own state.** A button that triggers a fetch is
    `disabled` and muted (`disabled:opacity-50`) while in flight — never a live
    button sitting next to a spinner.

## Smell test — fix before "done"

- More than one accent hue on screen → collapse to `#3772cf` + semantics.
- Everything centered → left-align the content.
- New emoji in nav/buttons/headers → remove or replace with an SVG/glyph.
- Arbitrary `[..px]` / hex literals → map to a token.
- Equal spacing everywhere (`gap-4` between all things) → use rhythm: tight
  within a group (`gap-1.5`/`gap-2`), generous between groups (`mb-6`/`mb-8`).
- A view that can fetch but has no loading/empty/error branch → add them.
- Hairline borders missing on cards/rows → `border border-hairline`.
- Buttons of different heights/paddings side by side → match them.
- `transition-all` anywhere → narrow to `transition-colors`/`-opacity`/`-transform`.
- Interactive element with no `focus-visible` ring → add one.
- Icon-only/emoji-only control with no text → add an `aria-label`.
- A submit/fetch button still clickable while its request is in flight → `disabled`.

## Quick reference (established patterns — reuse, don't reinvent)

| Element | Pattern |
|---|---|
| Card | `bg-canvas border border-hairline rounded-lg` |
| Row hover | `hover:border-[#3772cf]/50 transition-colors` (≤180ms) |
| Primary button | `bg-[#3772cf] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#2c5cab]` |
| Ghost button | `border border-hairline text-steel hover:bg-surface` |
| Status pill | `rounded-full px-2 py-0.5 text-xs font-medium` + 10%-tint bg |
| Section label | `text-[11px] uppercase tracking-wider font-mono text-[#3772cf]` |
| Muted meta | `text-xs text-stone` |

## Common mistakes

- **Decorative color.** A green border "because it looks nice" — green means
  *done*. Color carries meaning here; don't spend it on decoration.
- **Spinner soup.** A centered spinner for a 100ms mock fetch. Use a skeleton
  shaped like the content, or nothing.
- **Over-rounded.** `rounded-2xl` pills and cards read as consumer-app. Cards
  are `rounded-lg`, controls `rounded-md`, pills `rounded-full`.
- **Icon zoo.** Mixing emoji, three SVG sets, and Unicode arrows. Pick one
  source per surface.
- **Dead density.** Uniform spacing flattens hierarchy. Group with tight gaps,
  separate groups with whitespace.

## When NOT to fuss

Internal/debug surfaces (raw JSON dumps, the agent canvas dev view) get
function over polish. Don't gold-plate a developer tool. This skill is for
user-facing studio screens.
