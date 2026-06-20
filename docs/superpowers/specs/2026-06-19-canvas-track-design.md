# Pre-Production Canvas track — design (Step 1: Scene Board + Shot Detail)

Status: approved 2026-06-19 · Branch: `claude/canvas-track` (on top of Pass-1 rig/studio refresh)
Source of truth: Claude Design project `b87becbd-…`, `ui_kits/animatory/` —
`canvasBoard.jsx` (SceneBoard + ShotDetail), `canvasData.jsx` (PPC fixture), `canvas.css`.

## Context

The redesign introduces a **Canvas** pre-production track that the local studio
doesn't have. It is a self-contained **paper/ink world**: warm paper, a single
**amber** accent, Space Mono + Bricolage Grotesque, and a pipeline status enum
(`extracted→designed→boarded→animated→done`) that is the only place status color
is spent. The track flow is **Scene Board → Shot Detail → Rig Studio**.

This spec covers **Step 1 only**: the Scene Board and Shot Detail. The Rig Studio
(`PPC_RigStudio`, ~68 KB) is **Step 2** — its own spec/plan. The redesign also
restructures the pre-production tab bar.

Decisions (confirmed):
- **Amber scoped to the Canvas track**, a documented per-surface exception (like
  the rig editor's dark+teal). The rest of the app stays one-accent `#3772cf`;
  the exception is recorded in the `ui-taste` skill.
- **Flush + keep tabs.** The board renders edge-to-edge, but the track tabs stay
  visible (it is a top-level track view). The fully-flush/no-tabs treatment is
  reserved for immersive editors (the rig editor; the Step-2 Rig Studio).
- **New Canvas data model**, mock-backed — `StoryboardPanel`/`Scene` are the
  wrong shape.

## Tab restructure

`TrackTabs` becomes **Design · Canvas · Animatic · Checking** (drops Storyboard &
Audio from the bar). Storyboard/Audio **routes and views remain in `App.tsx`**
(reachable by URL); only the tabs are removed. `phases.ts` gains a `canvas` track
id used for routing/labels. **`PRE_TRACKS`** (the advancement-gate set —
`design/storyboard/audio`) is **unchanged**, so `canAdvance` / gate logic is
unaffected by this purely-visual tab change.

## Data model (`studio/canvas/canvasData.ts`, new)

```ts
export type CanvasStatus = 'extracted' | 'designed' | 'boarded' | 'animated' | 'done'

export interface CanvasShot {
  id: string                 // 'SH-0011'
  action: string
  dialogue: string           // '' = none
  camera: string             // 'Slow push-in'
  duration: string           // '2.4s' (display string, not seconds)
  sfx: string
  status: CanvasStatus
  baked: boolean             // a baked animation clip exists
  characters: string[]       // character asset ids
}

export interface CanvasScene {
  id: string                 // 'SC-001'
  slug: string               // 'EXT. RAIN ALLEY — DAWN'
  locationId: string         // 'loc_0431-alley'
  status: CanvasStatus
  shots: CanvasShot[]
}
```

`STATUS_ORDER` + `STATUS_LABEL` mirror the enum; `isAnimated(s)` = `animated|done`.
Seed = the redesign's four-scene fixture (`canvasData.jsx`), verbatim shapes.

## API seam

- `studioApi.getCanvasScenes(projectId): Promise<CanvasScene[]>` — mock returns
  the seed; **httpApi throws "not implemented"** like the other pre-prod pre routes.
- Selection/lookup (`sceneById`, `shotById`) are pure helpers in `canvasData.ts`,
  not API calls.
- Mock state lives beside the existing `mockApi` seeds; `__resetStudioState`
  resets it.

## Routing (`App.tsx`, nested under `PreShell`)

| Path | View |
|---|---|
| `/project/:id/pre/canvas` | redirect → first scene |
| `/project/:id/pre/canvas/:sceneId` | **CanvasSceneBoard** |
| `/project/:id/pre/canvas/:sceneId/:shotId` | **CanvasShotDetail** |
| `/project/:id/pre/canvas/:sceneId/:shotId/studio` | *(reserved — Step 2)* |

The design's `navigate({track:'canvas', view, sceneId, shotId})` maps onto these
paths. "Open Studio" buttons are present but **disabled** in Step 1 (enabled in
Step 2).

## Components (`studio/canvas/`, new)

- **`CanvasSceneBoard.tsx`** — top board bar (title + crumb + **ratio picker**
  16:9 / 9:16 / 4:3 / 1:1) · left **scene rail** (each scene: id, status pill,
  slug, `n/total animated`, progress bar) · **shot grid** of `ShotCard`s (sketch
  thumb, status + voiced badges, action/dialogue/camera/duration/sfx fields,
  "Open Studio" disabled) + an "Add Shot" affordance (visual only in Step 1).
- **`CanvasShotDetail.tsx`** — shot bar (back-to-board + crumb + "Open Studio"
  disabled) · **ink draw-frame** (`PaperSketch`) + Clear · **shot-notes** aside
  (Action / Dialogue textareas, Camera / Duration / SFX inputs) · **status strip**
  (status pill, baked-clip dot, audio/voiced dot, ids).
- **`ShotThumb.tsx`** — deterministic pencil-gesture SVG sketch (denser past
  `boarded`), honest placeholder; never fake finished art.
- **`PaperSketch.tsx`** — `<canvas>` freehand ink (mouse + touch). **Ephemeral**
  in v1 (clears on shot change), matching the design; no persistence.
- **`StatusPill.tsx`** — the pipeline-enum pill (dot + label).
- **`canvas.css`** — the scoped `.ppc` token block (paper/ink, amber, status
  enum, radii, fonts) ported from the kit. Scoped under `.ppc` so amber/paper
  never leak into app chrome.

## Shell (`PreShell.tsx`)

Add a **track-flush** mode: when the route is `/pre/canvas`, render `TrackTabs`
(kept) but drop the `max-w-5xl` wrapper + the "Phase 2 / Pre-production" heading,
and let the board fill the width below the tabs. This is distinct from the rig's
**full-flush** (tabs dropped). Implementation: extend the existing `useLocation`
check — `/pre/rig` → full-flush, `/pre/canvas` → track-flush.

## States

- **Loading:** board renders a skeleton rail+grid (no spinner).
- **Empty:** no scenes → a sentence + the next action (centered, the one place
  centering is allowed).
- **Error:** surfaced inline (consistent with `DesignTrackView`).

## ui-taste / fonts

- Amber + paper tokens scoped under `.ppc`; status colors only on `StatusPill`.
- Space Mono + Bricolage Grotesque are loaded for the Canvas surface (the rest of
  the app keeps Inter + Geist Mono). Load via `@fontsource` or a scoped `@import`,
  not a new global default.
- Record the Canvas amber/paper exception in the `ui-taste` skill notes.

## Verification

- `tsc -b` clean; `vite build` green.
- Dev-server walkthrough (mock): Pre-production → **Canvas** tab → board (rail +
  shot grid + ratio picker + status pills) → open a shot → draw on the ink frame,
  edit notes, see the status strip → **Back to Board**. Tabs remain switchable.
- DOM/computed-style probes for proof (screenshots stall in this env, per Pass 1).

## Out of scope (Step 1)

- Real shot/scene persistence, "Add Shot" behavior, generation.
- Retiring the Storyboard/Audio views (only their tabs are removed here).

---

## Step 2a — Rig Studio (core)

The `PPC_RigStudio` is the Canvas track's animation editor, reached via **Open
Studio** from a shot. It is ~2,000 lines; **Step 2a builds the coherent core**
and defers the heaviest authoring to **2b** (user's choice).

**In 2a:**
- **Route** `/pre/canvas/:sceneId/:shotId/studio` → `CanvasRigStudio`; "Open
  Studio" (board ShotCard + Shot Detail bar) goes live. The studio is an
  immersive editor → **full-flush** (no track tabs; own "Back to Board"), so
  `PreShell` treats a `/studio` suffix as `full` (like the rig editor).
- **Studio data** — static `CHAR_LIB` / `LOC_LIB` / `OBJ_LIB` (id+name+kind,
  mirroring the fixture) + `charById` / `locById` in `canvasData.ts`.
- **Shell** — the `.ppc-studio` grid (tool rail · Characters dock · center ·
  right widget) + bar (scene/shot **cascading dropdowns**, status pill, Back to
  Board). Local `Dropdown` + a `studioGlyphs` module (the kit's transport/tool
  SVG glyphs — not in the shared Icon set).
- **Tool rail** — Select / Pose / Pan / Zoom + Add-keyframe + ink swatch.
- **Characters dock** — layer list (auto-seeded cast) + per-layer visibility.
  (Manual import picker = 2b; canvas auto-seeds from `shot.characters` +
  `scene.location`.)
- **Canvas** — background plate + draggable **figure layers** (Pose tool),
  zoom/pan (Zoom/Hand + wheel), background control, zoom HUD, layer-count badge.
- **Timeline** — extendable (drag-resize): transport (first/prev-key/prev-frame/
  play/next-frame/next-key/last, loop, fps, keyframe, frame+time readout), track
  heads (reorder, collapse, visibility), lanes with per-character **presence
  bands** (drag enter/exit) + **keyframe** diamonds + ruler + playhead, scrub,
  and **playback** (figure layers interpolate from their keyframes). Clip
  inspector for the selected presence band.
- **Right widget** — icon rail (section switch) + the **Script** section
  (read-only action/dialogue). Other sections show a "2b" placeholder.

**Deferred to 2b:** multi-track **clip authoring** (action/voice/object/effect/
sfx — add/drag/trim/split/sub-lanes), the 5 right-panel **generators**, **canvas
object/effect sprites**, and the **picker modals**.

**Verify:** `tsc -b` + `vite build` green; preview — board → Open Studio
(full-flush) → drag a figure to pose, zoom/pan, add a keyframe, scrub/play
(figure interpolates), drag a presence band, resize the timeline, switch
scene/shot via the dropdowns, Back to Board.
