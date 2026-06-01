# Animatory Studio UI — Design Spec

**Date:** 2026-06-02
**Status:** Approved for planning
**Scope:** Frontend + mock data layer only. No backend, no changes to existing agent-running logic.

---

## 1. Purpose

Add a project-management UI on top of the existing Animatory frontend. The new
"Studio" surface lets a production manager drive a 2D-animation episode through a
four-phase pipeline:

```
Parse → Pre-production → Vendor Studio → Post-production
```

The existing agent-facing tools (Agent Canvas, Runs, Metrics) remain untouched
and reachable from the same top nav. The studio is a higher-altitude, user-friendly
view; the agent canvas is the low-level engineering view. The two are **separate but
linked**: vendor scene rows expose a lightweight link into the existing Agent Canvas.

All studio data comes from an isolated mock-data layer (`studioApi`) returning
promises, so a real backend can be swapped in later without touching any component.
In-memory state only — no `localStorage`.

---

## 2. Integration Approach (chosen: Option A)

New route group sharing the existing app shell and nav.

- `/` becomes the **Projects dashboard** (replaces the old `Navigate to="/agents"` redirect).
- New `/project/:id/:phase` routes added to `App.tsx`.
- Studio and agent tools share one top nav: **Projects · Agent Canvas · Runs · Metrics**.
- Only two existing files are edited: `App.tsx` (routes) and `AppShell.tsx` (nav item).
- All studio mock data lives in a new isolated module — never imported raw by components.

Rejected alternatives: a parallel Vite app (duplicate maintenance), and a
feature-flagged `/studio/*` sub-app (awkward URLs, split identity).

---

## 3. File & Folder Structure

```
frontend/src/
  studio/
    mockApi.ts          # studioApi: promise-based project/scene/asset/vendor/post data
    types.ts            # Project, Scene, Asset, VendorScene, PostStage, PhaseStatus
    views/
      DashboardView.tsx        # /
      ParseView.tsx            # /project/:id/parse
      PreProductionView.tsx    # /project/:id/pre
      VendorView.tsx           # /project/:id/vendor
      PostView.tsx             # /project/:id/post
    components/
      PhaseStepperBar.tsx      # persistent 4-step stepper across all project views
      ProjectCard.tsx          # dashboard grid card
      SceneCard.tsx            # parse grid + storyboard track
      AssetCard.tsx            # design track
      PipelineRow.tsx          # vendor per-scene row

  App.tsx              (edit)  # add / and /project/:id/* routes
  components/
    AppShell.tsx        (edit) # add "Projects" nav item
```

`studio/mockApi.ts` exports a single `studioApi` object following the same pattern
as the existing `api/index.ts`. No component imports raw mock arrays directly.

---

## 4. Data Model

```ts
// studio/types.ts

type PhaseStatus = 'locked' | 'active' | 'complete'

interface Project {
  id: string
  title: string                          // editable inline
  thumbnail?: string                     // CSS color/gradient string for now (no real images)
  currentPhase: 'parse' | 'pre' | 'vendor' | 'post'
  phases: { parse: PhaseStatus; pre: PhaseStatus; vendor: PhaseStatus; post: PhaseStatus }
  sceneCount: number
  createdAt: string
}

interface Scene {
  id: string
  projectId: string
  number: number
  description: string
  location: string
  characters: string[]
  duration: string                       // e.g. "0:42"
}

interface Asset {
  id: string
  projectId: string
  name: string
  type: 'character' | 'prop' | 'background' | 'fx'
  status: 'rough' | 'clean' | 'color' | 'done'
  emoji: string                          // placeholder thumbnail
}

interface VendorScene {
  id: string
  projectId: string
  sceneRef: string                       // e.g. "SC-01"
  stage: 'rigs' | 'setup' | 'block' | 'animate' | 'take1' | 'editor'
  stageStatus: 'pending' | 'active' | 'done' | 'retake'
  retakeCount: number
  completedStages: string[]
  approved: boolean
}

interface PostStage {
  id: string
  name: string
  sub: string
  status: 'done' | 'active' | 'pending' | 'locked'
  parallel?: boolean                     // true = rendered inside the audio-tracks block
  track?: 'dialogue' | 'music' | 'sfx'
}
```

### `studioApi` methods

All async, all add an artificial 80–150ms delay to simulate network latency.

- `listProjects(): Promise<Project[]>`
- `getProject(id): Promise<Project>`
- `updateProjectTitle(id, title): Promise<Project>`  — inline rename
- `getScenes(projectId): Promise<Scene[]>`
- `getAssets(projectId): Promise<Asset[]>`
- `getVendorScenes(projectId): Promise<VendorScene[]>`
- `getPostStages(projectId): Promise<PostStage[]>`

State is held in module-level in-memory arrays. Mutations (`updateProjectTitle`)
update those arrays so changes persist for the session but reset on reload.

---

## 5. Routing & Nav

### `App.tsx`

```tsx
<Route path="/" element={<DashboardView />} />
<Route path="/project/:id/parse"  element={<ParseView />} />
<Route path="/project/:id/pre"    element={<PreProductionView />} />
<Route path="/project/:id/vendor" element={<VendorView />} />
<Route path="/project/:id/post"   element={<PostView />} />
// existing routes unchanged: /agents, /runs, /runs/:runId, /runs/:runId/monitor, /metrics
```

The old `/` → `/agents` redirect is removed.

### `AppShell.tsx`

One new nav item prepended: **Projects** (links to `/`). Active-state styling
follows the existing nav pattern. Existing items (Agent Canvas, Runs, Metrics)
unchanged.

### `PhaseStepperBar`

- Renders on all `/project/:id/*` routes, between the nav and page content.
- Reads the project's `phases` map to mark each of the 4 steps `complete` / `active` / `locked`.
- Clicking a `complete` or `active` step navigates to that phase; `locked` steps are inert.
- Project title shown right-aligned, click-to-edit inline: clicking swaps the label
  for an `<input>`; `blur` (or Enter) saves via `studioApi.updateProjectTitle` and
  swaps back. Escape cancels.

---

## 6. Screen Behaviour

### Dashboard (`/`)
Grid of `ProjectCard`s from `listProjects()`. Each card shows thumbnail (color
block), title, scene count, and a color-coded phase badge (Parsing / Pre-prod /
Vendor / Post). Clicking a card routes to `/project/:id/<currentPhase>` — "jumps in"
to wherever the project currently is. Primary "New Project" button top-right routes
to a fresh `/project/:id/parse` (mock-creates a project). Title is also editable
inline on the card.

### Script Parsing (`/project/:id/parse`)
File-upload zone (mocked — clicking/dropping adds a file chip, no real upload) plus
a paste-text option. After "parsing," shows a grid of `SceneCard`s from
`getScenes()` — each with scene number, one-line description, location, characters,
duration. "Continue to Pre-production" advances the project (sets `parse` phase
`complete`, `pre` `active`) and navigates to `/project/:id/pre`.

### Pre-production (`/project/:id/pre`)
Three parallel track cards — **Design**, **Storyboard**, **Casting** — each showing
its own progress (e.g. "8 of 12 assets done"). Clicking a track opens its sub-view
below (tab-style, in-page):
- **Design:** grid of `AssetCard`s (characters / props / backgrounds / fx) with
  status rough / clean / color / done.
- **Storyboard:** the scene clips from parsing, each expandable into a shot list.
- **Casting:** list of characters, each with an assigned voice and a play-stub button.

When all three tracks read complete, the "Send to Vendor Studio" action unlocks and
advances the project to the vendor phase.

### Vendor Studio (`/project/:id/vendor`)
Per-scene pipeline. Each `PipelineRow` shows a scene moving through six sequential
stages: **Build Rigs → Set Up → Block → Animate + lip-flap → Send Take 1s →
Editor Review**. The Editor stage can loop back ("retake") to an earlier stage —
shown as a `retake` status with a per-scene retake counter. A scene is `done` only
when the editor approves. Header shows overall "X of N scenes complete." Mock data
includes varied states: approved, mid-pipeline, retake-loop, queued. Each row also
exposes a lightweight **↗ Agent Canvas** link that navigates to the existing
`/agents` view (future: `?scene=SC-09` query param to filter). "Send to
Post-production" unlocks when all scenes are approved.

### Post-production (`/project/:id/post`)
Vertical post pipeline from `getPostStages()`:
`Edit → [Dialogue ‖ Music ‖ SFX] → Mix → Color Correction → Online/QC → Deliver`.
The three audio tracks render in parallel inside a single block. Each stage shows
its status. The final "Deliver" action marks the project `complete`.

---

## 7. Visual Style

Clean, modern, professional creative-tool aesthetic (Linear / Notion, not consumer):

- Calm neutral background (`#f5f4f2`), single blue accent (`#2563eb`), generous whitespace.
- No heavy gradients (thumbnails use subtle dark gradients as placeholders only), no clutter.
- Phase badge colors: Parse = purple, Pre = amber, Vendor = blue, Post = green.
- Asset/stage status colors reuse the same palette consistently.
- Reuses existing Tailwind tokens where they fit; studio-specific tokens added to
  `tailwind.config.ts` only if needed. Inter for UI, Geist Mono for IDs/scene refs.

The committed `mockup/index.html` is the visual reference for all five screens.

---

## 8. Out of Scope

- Real file upload / parsing (mocked).
- Real backend or persistence beyond in-memory session state.
- Filtering the Agent Canvas by scene (link navigates to `/agents` for now).
- Audio playback (casting/post "play" buttons are stubs).
- Any change to existing agent-running code, executors, or the backend.

---

## 9. Testing

- `studioApi` unit-testable in isolation (deterministic mock data, promise resolution).
- Components consume `studioApi` only — no raw data imports — so each view can be
  tested against a stubbed api.
- Manual verification against the five mockup screens via the existing Vite dev server.
