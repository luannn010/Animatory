# Image Generation Middleware (`/imagegen`)

A thin async router mounted inside the Animatory backend that drives the local
**Z-Image Turbo** pipeline to generate rigs, backgrounds, and shots — plus train
and apply character **LoRAs** — without ever blocking the request path or
competing with the chat LLM for VRAM.

It is **middleware, not a separate service**: it reuses the backend's asyncio +
SQLite job model and shares one GPU engine with the rig pipeline, so there is a
single VRAM owner on the box.

---

## At a glance

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/imagegen/generate` | Enqueue a generation job → `202 {job_id}` |
| GET  | `/imagegen/jobs/{job_id}` | Poll a generation job |
| GET  | `/imagegen/assets` | List finished assets (filter by `type`/`scene_id`/`character_id`) |
| GET  | `/imagegen/loras` | List available trained LoRAs |
| POST | `/imagegen/loras/train` | Train a character LoRA from its rig refs → `202 {job_id}` |
| GET  | `/imagegen/trainings/{job_id}` | Poll training progress (step/total/loss) |
| GET  | `/imagegen/healthz` | `{ok, free_vram_mb, engine_loaded}` |

Generated PNGs are written under the output dir and served read-only at
`/outputs/...` (mounted in `server.py`).

---

## Architecture

```
POST /generate ──► create job (queued) ──► asyncio.create_task(run_job)  ──► 202 {job_id}
                                                  │
                                          [ _gpu_lock ]  ← single VRAM owner, serializes all jobs
                                                  │
                          acquire VRAM ─► generate+save ─► release engine ─► (LoRAs unloaded)
                                                  │
GET /jobs/{id} ◄────────────────── job row (queued|running|done|error, image_url, seed)
```

- **Async submit + poll.** `POST /generate` returns `202` immediately; a
  fire-and-forget task runs `service.run_job`. The API never blocks on
  inference. Clients poll `GET /jobs/{id}`.
- **One GPU lock.** `service._gpu_lock` (an `asyncio.Lock`) serializes every
  generation and training job, so two requests never load the 6B transformer at
  once on the 8GB card.
- **Shared engine.** `server.py`'s lifespan builds one `ZImageEngine` and passes
  it to both the rig-pipeline executor and the imagegen router via
  `app.state.image_engine`.
- **Dependencies on `app.state`:** `image_job_store` (SQLite), `lora_registry`,
  `image_engine`, `image_cfg`, `image_out_dir`.

Module layout (`animatory/imagegen/`):

| File | Role |
|------|------|
| `router.py` | FastAPI `APIRouter(prefix="/imagegen")` — the routes above |
| `schemas.py` | Pydantic request/response models |
| `presets.py` | Asset-type presets + prompt building (dependency-free, unit-tested) |
| `service.py` | `run_job` / `run_train_job` — GPU-locked workers |
| `jobs.py` | `ImageJobStore` (aiosqlite) + per-character seed table |
| `lora.py` | `LoraRegistry` — resolve/list `*.safetensors` in `LORA_DIR` |
| `lora_train.py` | QLoRA trainer module + `python -m animatory.imagegen.lora_train` CLI |

---

## Generating an asset

```bash
curl -X POST localhost:8000/imagegen/generate -H 'content-type: application/json' -d '{
  "asset_type": "rig",
  "prompt": "handsome asian businessman, 32, white suit, glasses, briefcase",
  "character_id": "biz_man",
  "seed": 42
}'
# → 202 {"job_id": "...", "status": "queued"}

curl localhost:8000/imagegen/jobs/<job_id>
# → {"status": "done", "image_url": "/outputs/...png", "seed": 42, ...}
```

### Asset-type presets (`presets.py`)

Callers send only `asset_type` + `prompt`; the preset fills anything left
`None` (size, steps, cfg). Three types:

| `asset_type` | Composition | Default size |
|-----------|-------------|--------------|
| `rig` | full-body single character | 768×1152 |
| `background` | wide establishing plate, no characters | 1920×1080 (env-overridable) |
| `shot` | free-form composed scene | 1280×720 |

**Style spine — the consistency fix.** A shared `STYLE_SPINE` (flat 2D toon /
cel-shaded / anime-manhua) is prepended to **every** asset type, and a
`STYLE_NEGATIVE` (photoreal/3d/photograph) is appended to **every** negative.
Without this, weak per-type cues let Z-Image (which defaults to photorealism)
drift — e.g. a flat-toon rig but a realistic shot. Only the *composition*
prefix differs per type.

> `background` defaults to 1920×1080. On an 8GB card that is risky even with NF4
> + offload, so override with `IMAGEGEN_BG_WIDTH` / `IMAGEGEN_BG_HEIGHT`.

### Seed consistency

Pass `seed` for reproducibility. If you pass `character_id` without a seed, the
first job's seed is stored and **reused** for every later job for that character
(`jobs.py` `character_seeds` table) — the cheap path to character consistency.
Seed alone is good for variations; for true identity across new compositions,
train a LoRA (below).

---

## LoRA: train and apply

### Train

`POST /imagegen/loras/train` trains a character LoRA from that character's rig
reference images. Drop **8–12** reference PNGs in
`rigs/character/<slug(name)>/refs/` (or pass `refs_dir`), then:

```bash
curl -X POST localhost:8000/imagegen/loras/train -H 'content-type: application/json' -d '{
  "name": "biz_man", "trigger": "bizman", "steps": 1500, "rank": 8
}'
# → 202 {"job_id": "..."}; 400 if the refs folder is empty.

curl localhost:8000/imagegen/trainings/<job_id>
# → {"status": "running", "step": 420, "total": 1500, "loss": 0.13, ...}
```

- **Subprocess isolation.** Training runs as a child process
  (`python -m animatory.imagegen.lora_train ... --progress <file>`); the worker
  holds the GPU lock, releases the in-process engine first, and polls the
  progress file to update the job. A crash can't take down the API.
- **QLoRA on 8GB.** NF4-quantized transformer + model CPU offload. The loss
  follows Z-Image's flow-matching contract (see
  [`zimage_lora_training` memory] / `animatory/zimage/train.py`):
  target = `x0 − noise`, transformer timestep = `1 − sigma`, LoRA target modules
  `to_q/to_k/to_v/w1/w2/w3`.
- **Output.** Saved as `<slug>.safetensors` in `LORA_DIR` and marked into the
  rig's `rig.json` so it can be auto-applied later.

### Apply (single pass, stackable)

Generation requests carry a `loras` list — **multiple LoRAs apply in one pass**,
not in phases:

```jsonc
{
  "asset_type": "shot",
  "prompt": "two businessmen eating at a deluxe restaurant",
  "loras": [
    {"name": "biz_man", "weight": 0.8},
    {"name": "restaurant_style", "weight": 0.5}
  ]
}
```

The engine's `attach_loras([...])` loads each adapter and calls
`set_adapters([names], [weights])` for a single blended forward pass. LoRAs are
always unloaded in a `finally` so they never leak into the next job. An unknown
name fails the job cleanly (`LoraNotFound`).

---

## Brain / VRAM coordination

The local chat LLM (`llama-server`, ~7.8GB) and Z-Image cannot both hold VRAM on
the 8GB card. The GPU arbiter (`animatory/zimage/brain.py`) hibernates the brain
before loading Z-Image, releases the pipeline after each batch, and re-wakes the
brain — **once workerd's brain control plane is enabled**
(`BRAIN_CONTROL_ENABLED=true`, control on `127.0.0.1:8089`; Windows→WSL needs
`BRAIN_VIA_WSL=1`). Until then it fails fast with guidance.

### Parse/reparse preflight

Because Z-Image hibernates/kills the chat LLM, parse and reparse would otherwise
hit a dead endpoint and emit a 3×-retry `503 ConnectError` traceback.
`scene_parser.ensure_chat_available()` now runs first:

1. Ping `QWEN_ENDPOINT/v1/models`.
2. If down, try `brain.BrainClient().wake()` and poll until reachable.
3. If still down (or control plane disabled), raise `ChatUnavailableError` with
   an actionable message — **no retry storm**.

Mapped to **HTTP 503** on the reparse route; a parse run ends `failed` with the
clean message. Gated by `CHAT_PREFLIGHT` (default `1`; tests set `0`).

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `LORA_DIR` | `loras` | Where trained `*.safetensors` live |
| `ZIMAGE_RIGS_DIR` | `rigs` | Rig refs root (`<kind>/<name>/...`) |
| `IMAGEGEN_BG_WIDTH` / `_HEIGHT` | `1920` / `1080` | Background plate size override |
| `ZIMAGE_QUANT` | `bnb4` | Transformer quantization (NF4) |
| `ZIMAGE_RELEASE_AFTER` | `1` | Release pipeline after each batch |
| `CHAT_PREFLIGHT` | `1` | Run the parse/reparse chat preflight |
| `BRAIN_CONTROL_ENABLED` | `false` | Enable workerd brain control plane |
| `BRAIN_VIA_WSL` | — | Set `1` for Windows→WSL control calls |

---

## Tests

```bash
ANIMATORY_FAKE_EXECUTORS=1 pytest tests/test_imagegen.py tests/test_chat_preflight.py -v
```

`tests/test_imagegen.py` covers presets, the LoRA registry, `run_job` (rig,
unknown-LoRA, LoRA-unload, per-character seed), GPU-lock serialization, the HTTP
endpoints, multi-LoRA stacking, and `run_train_job` (success/failure via a fake
`run_cmd`). `tests/test_chat_preflight.py` covers the preflight (reachable /
unreachable-raises / wake-recovers / disabled-noop). All generation and training
in tests uses fakes — **no GPU required**.
