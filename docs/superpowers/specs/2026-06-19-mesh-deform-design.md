# Mesh Deform (Deform v2) — Design

Status: backend implemented; front-end (three pages) planned. Source briefs:
`DEFORM_BACKEND_SPEC.md` (backend) + `DEFORM_PAGE_HANDOFFS.md` (front-end), vendored and
reconciled here. This is the in-repo source of truth (`docs/superpowers/specs/`).

Mesh deform turns a character PNG into a riggable 2D triangle mesh, seeds per-vertex bone
weights, and persists it. The **backend** owns the slow, one-time, compute-heavy half
(triangulate → auto-weight → persist, behind an async SSE job). The **front-end** owns the
60fps half (weight-paint brush, linear-blend-skinning pose preview, rendering) — deferred.

Code: `animatory/deform/` — `models.py`, `triangulate.py`, `weights.py`, `store.py`,
`service.py`, `router.py`. Mounted in `animatory/server.py`; routes under `/studio`.

## Scope (backend)

In: alpha-silhouette triangulation (vertices/triangles/uvs); initial per-vertex auto-weights;
one async job with SSE progress; persist mesh+weights+bind-pose per asset; accept painted-weight
updates. Out (front-end): LBS per frame, the brush + live repaint, pose→bone matrices, rendering.

## Reconciliation decisions (deviations from the raw backend brief)

- **R1 — the skeleton travels in the `generate` request.** The brief assumed the bind-pose
  skeleton was readable from `rig.json`; it is not (`animatory/genimage/zimage/rig.py` `rig.json`
  has no bones, and the editable `RigDoc.skeleton` is front-end mock-only with no `/studio/rigs`
  route). So `GenerateMeshRequest.bones` carries the resolved bind-pose (per-bone pivot+tip in
  image-pixel space), snapshotted into `MeshData.bindPose`. Decouples deform from unbuilt rig
  persistence and makes it unit-testable. Backend rig persistence stays a separate follow-up.
- **R2 — the image travels in the request.** Studio design-track generation is a stub and there
  is no studio asset→art link, so `generate` accepts `imageDataUrl` (base64 data URL) **or**
  `imageRef` (a path under `ZIMAGE_OUT_DIR`, served at `/outputs`). Exactly one is required.
- **R3 — new `animatory/deform/` domain package**; router paths under
  `/studio/assets/{assetId}/mesh/...` (matches the brief). `assetId` is an opaque key.
- **R4 — triangulation without the `triangle` C extension.** To avoid a C build on Windows we use
  `skimage.measure.find_contours` (alpha outline) + `shapely` (Douglas–Peucker simplify, polygon
  containment) + interior grid points + `scipy.spatial.Delaunay` + a centroid-in-polygon filter.
  Pure-wheel deps (`numpy`, `scipy`, `scikit-image`, `shapely`, `pillow`). Quality is good enough
  for the MVP wireframe; swapping in constrained-Delaunay (`triangle`) later is a drop-in.
- **R5 — coordinate-space contract.** `bones` MUST be in the PNG's pixel space; the front-end owns
  the rig-canvas→image mapping. The backend trusts the provided coordinates.
- **R6 — stores.** `MeshData` is durable (aiosqlite, like `ImageJobStore`); `MeshJob` is ephemeral
  (in-memory dict, like the studio `ParseJob`). One job per asset; a second `generate` while one is
  running returns the in-flight `jobId`.

## Data model (`models.py`, camelCase JSON)

- `MeshParams` — `density: coarse|medium|fine`, `interiorPoints: bool`, `weightMethod: distance-falloff|bone-heat`.
- `BindBone` — `id, x, y, tipX, tipY` (image px).
- `GenerateMeshRequest` — `params, bones[], imageDataUrl?, imageRef?`.
- `VertexWeight` — `bones[<=4], values[]` (parallel, sum 1).
- `MeshData` — `assetId, version, vertices[], triangles[], uvs[], bindPose{boneId:[x,y,tipX,tipY]},
  weights[], textureUrl, status: none|generating|rigged|failed, generatedAt, params`.
- `MeshJob` — `jobId, assetId, status: queued|running|done|failed, progress, stage:
  triangulating|weighting|packing|done, error`.

## API (`/studio`)

| Method · Path | Body | Response |
|---|---|---|
| `POST /studio/assets/{assetId}/mesh/generate` | `GenerateMeshRequest` | 202 `MeshJob` (in-flight job if one is running) |
| `GET  /studio/assets/{assetId}/mesh/jobs/{jobId}/stream` | — | SSE: `progress`(stage+pct) · `done`(MeshData) · `error` |
| `GET  /studio/assets/{assetId}/mesh/jobs/{jobId}` | — | `MeshJob` (poll fallback) |
| `GET  /studio/assets/{assetId}/mesh` | — | `MeshData` (404 unless rigged) |
| `PUT  /studio/assets/{assetId}/mesh/weights` | `{weights: VertexWeight[]}` | `MeshData` |
| `DELETE /studio/assets/{assetId}/mesh` | — | 204 (status → none) |

`saveWeights` validation (422 on failure): one weight per vertex; each `len(bones)==len(values)`,
`<=4` bones, `sum(values)==1±ε`, every bone id present in the stored `bindPose`.

## Job lifecycle (`service.py`, mirrors imagegen `run_job` + brief §5)

`generate` → create `MeshJob{queued}`, mesh `status=generating`, `asyncio.create_task(run_mesh_job)`,
return `{jobId}`. Worker (heavy steps via `asyncio.to_thread`): `triangulating`(0→.5) →
`weighting`(.5→.9) → `packing`(.9→1) → persist `MeshData(status=rigged)`, emit `done`. On error:
`status=failed`, keep the job for inspection. Never raises to the request.

## Build order (brief §7; MVP = 1–4, shipped)

1. Triangulation + store + the six endpoints. 2. SSE job wrap with real stages. 3. distance-falloff
weighter. 4. `saveWeights` validate + persist + version. 5. *(later)* bone-heat method.
6. *(later)* disjoint islands / off-silhouette bone / rig-change `stale` flags (brief §6).

## Front-end (planned, NOT built) — from `DEFORM_PAGE_HANDOFFS.md`

`DeformLibraryView` (`/project/:id/deform`) status tiles · `MeshGenerateView`
(`/project/:id/deform/:assetId/generate`) density/method + SSE progress · `WeightPaintView`
(`/project/:id/deform/:assetId/paint`) WebGL mesh, weight-tint, brush, pose-preview (LBS), Save →
`PUT /weights`. One accent `#3772cf`; the blue→red weight ramp is functional, not decorative;
tokens-only; run `ui-taste`.
