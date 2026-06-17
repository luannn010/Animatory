# Rig Editor — RigStage (Konva canvas) TODO

The bones-only Rig Editor v1 scaffold is built and wired
(`frontend/src/studio/rig/*`, `views/pre/RigEditorView.tsx`). Everything around
the canvas is done — data model, FK math (unit-tested), reducer, mock-first
persistence, hierarchy tree, inspector, timeline, JSON export/import. **The one
remaining piece is the interactive stage**: replace the placeholder
`frontend/src/studio/rig/RigStage.tsx` (currently a read-only SVG preview) with a
real Konva canvas. This doc is the task list for that.

## Ground rules

- **Keep the props contract identical** so `RigEditorView` needs no changes:
  `{ bones, pose, selectedBoneId, onSelectBone, mode, width?, height? }`.
- **Dispatch the existing reducer actions** — don't add state to the stage. The
  reducer (`rigReducer.ts`) already has every action you need:
  `addBone`, `updateBone`, `removeBone`, `selectBone`, `setPoseDelta`,
  `addLayer`, `updateLayer`, `removeLayer`. To dispatch from the stage, thread a
  few callbacks down as new props (e.g. `onAddBone`, `onPoseBone`, `onAddLayer`)
  — additive, the existing ones stay.
- **Use the FK helpers** from `rig/fk.ts` to draw and hit-test:
  `resolveSkeleton(bones, pose)` → `Map<id, {x,y,angle,tipX,tipY}>`. Never
  recompute bone transforms by hand.
- **Raw px / coordinates are allowed only inside the canvas drawing code** (brief
  §7). All surrounding chrome stays on design tokens.
- **Gate handlers by `mode`** (brief §7): pose-dragging must not fire in Rig mode
  and bone-placement must not fire in Pose mode. Deform mode is a no-op (V2).
- One accent `#3772cf`; teal `#00d4a4` only for live/pose feedback.

## Setup

```bash
cd frontend && npm install konva react-konva
```

(Both were intentionally NOT added yet — no unused dep until the stage lands.)

## Tasks (in brief build order)

### 1. Swap SVG → Konva (the shell of the stage)
- Replace the `<svg>` body with `<Stage><Layer>…</Layer></Stage>`.
- Keep the "Konva stage mounts here" badge removal and the empty state ("add a
  root bone") — those move into the Konva version.
- Render the resolved skeleton: for each bone, a `Line` (pivot→tip), a pivot
  `Circle`, a tip-handle `Circle`. Selected bone uses the accent; others
  `steel`/`stone`. Click a bone → `onSelectBone(id)`.
- A bones **overlay layer** sits above the art layer so handles stay visible.

### 2. Image import + pan/zoom (brief §6.2)
- Accept drop / file-select of one or more PNG part images onto the stage.
- For each, create an `ArtLayer` (see `types.ts`) via `onAddLayer` with a fresh
  id, the object URL as `src`, `boneId: null`, `offset {0,0}`, `rotationOffset 0`.
- Pan: drag empty canvas → translate the stage. Zoom: wheel → scale about the
  cursor. Keep a `{scale, x, y}` view transform local to the stage; convert
  pointer coords to canvas space for all hit-tests and bone placement.
- v1 takes **multiple PNGs (one per part)**. A single flat image to be sliced is
  a v2 import-helper concern — do not block on it.

### 3. Rig mode — place + chain bones (brief §6.3)
- Empty skeleton: first click places the **root** at the click point
  (canvas-space), pointing up. Dispatch `onAddBone` with a full `Bone`
  (`parent:null`, `x,y` = click, `len` default, `angle` default, `mesh:null`).
- With a selected bone: click places a **child** whose pivot is the selected
  bone's resolved **tip**; compute `len` and absolute `angle` from the click
  point relative to that tip. `parent` = selected bone id. (For children, `x,y`
  are bookkeeping — the pivot is always the parent's tip via FK.)
- Generate ids as `b{n+1}` (see `nextBoneId` in `RigEditorView`).
- Live-preview the bone being dragged out before releasing (optional polish).

### 4. Pose mode — drag to rotate (brief §6.4 — proves FK)
- Drag a bone's **tip handle**: compute the angle from the bone's resolved
  **pivot** to the pointer, subtract the bone's resting absolute angle and the
  inherited parent rotation to get the **delta**, then `onPoseBone(id, delta)`
  → reducer `setPoseDelta`.
  - delta = `atan2(pointer.y − pivot.y, pointer.x − pivot.x) − restAbsoluteAngle`
    where `restAbsoluteAngle` is what `resolveBone` would give at zero delta for
    this bone (i.e. parentAngle + (childRest − parentRest)). Easiest: resolve the
    skeleton once at the current pose, read the bone's current absolute angle and
    its current delta, and adjust delta by the change in pointer angle.
- Children inherit automatically — you only ever write the dragged bone's delta;
  `resolveSkeleton` propagates. **This is the FK proof; eyeball it against
  `fk.test.ts`.**
- Show the live delta in teal (the inspector already does; mirror near the handle
  if you like).

### 5. Art-layer binding (brief §5 — do BEFORE mesh/IK)
- Bind a layer to a bone: drag a layer onto a bone, or a dropdown in the layer
  list → `onUpdateLayer(id, { boneId })`. Store `offset` (layer origin relative
  to the bone pivot) and `rotationOffset` when bound.
- **Every frame**, set each bound layer's Konva `Image` transform from
  `resolved = resolveSkeleton(bones, pose)`:
  `image.position(pivot + rotate(offset, resolved.angle)); image.rotation(resolved.angle + rotationOffset)`.
- **Rigid only** — one layer follows one bone. Deforming a layer across a joint
  is the v2 mesh job; do not attempt it here.

### 6. Mode gating + selection sync
- `mode === 'rig'` → placement/inspector edits; `mode === 'pose'` → tip-drag
  rotates; `mode === 'deform'` → stage is read-only (V2 stub).
- Clicking a bone in the canvas selects it in the tree and vice-versa (already
  wired via `selectedBoneId` / `onSelectBone`).

## Definition of done (matches the brief)

- Import a character (PNG parts), place a multi-bone skeleton, see the hierarchy.
- Pose mode rotates a bone and its children correctly (FK already unit-tested).
- Bound art parts move with their bones (rigid).
- Two+ keyframes tween on Play with ease-in-out over `duration_s` (already wired
  in the timeline; the stage just needs to render `previewPose(state)` — it
  already receives the tweened pose).
- Export produces valid `RigDoc` JSON that round-trips back in (already wired).
- All chrome on tokens + the single `#3772cf` accent; run the `ui-taste` skill.

## Out of scope (v2+, keep fenced)

Mesh deformation / weight painting · IK · auto-rig from an image · LLM motion ·
multi-clip library UI. `Bone.mesh` stays `null`; `clips[]` stays an array with
one clip. Deform mode stays a greyed no-op stub.
