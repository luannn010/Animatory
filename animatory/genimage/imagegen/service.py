"""The imagegen worker (BACKEND_SPEC.md §7).

``run_job`` is the only place that touches the GPU. It is serialized by a process-level
``asyncio.Lock`` (single-GPU mutex, spec §7/acceptance 7) and runs the blocking parts
(VRAM gate, inference, save) in a thread so the event loop stays responsive.

Flow per job:
1. resolve seed (reuse per-character seed when a rig omits one — spec §10),
2. ``apply_defaults`` + ``build_prompts`` (the enhance layer),
3. resolve every LoRA name to a path **before** the GPU work (unknown name → fail loudly),
4. under the GPU lock: ``brain.ensure_vram_for_zimage`` → attach/stack LoRAs → generate → save,
5. ``finally``: unload LoRAs (no leak between jobs), release the pipeline, restore the brain.

The engine is injected, so tests pass a fake (no torch/GPU). Only a real ``ZImageEngine``
triggers the brain VRAM gate / pipeline release — a fake engine skips both.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import sys
from pathlib import Path

from animatory.genimage.imagegen.lora import LoraNotFound, LoraRegistry
from animatory.genimage.imagegen.presets import apply_defaults, build_prompts
from animatory.genimage.zimage.train import _slug

logger = logging.getLogger(__name__)

# Single-GPU mutex: only one inference holds the card at a time (spec §7).
_gpu_lock = asyncio.Lock()


class VramUnavailable(Exception):
    """The VRAM gate could not free enough memory (mapped to ``error: vram…``)."""


def _new_seed() -> int:
    return random.randint(0, 2**31 - 1)


def _adapter_name(lora_name: str) -> str:
    """diffusers adapter names must be identifier-ish; derive a stable one from the file name."""
    return "".join(c if c.isalnum() else "_" for c in lora_name)


def _is_oom(msg: str) -> bool:
    m = msg.lower()
    return "out of memory" in m or "cuda oom" in m or "alloc" in m and "memory" in m


def _oom_guidance(asset_type: str, msg: str) -> str:
    base = f"out of VRAM generating {asset_type}: {msg}"
    if asset_type == "background":
        return (
            base + " — the 1920x1080 background plate exceeds this 8GB card. Lower it via "
            "IMAGEGEN_BG_WIDTH / IMAGEGEN_BG_HEIGHT (e.g. 1280x720), or pass smaller width/height."
        )
    return base + " — reduce width/height/steps or free more VRAM."


# -- blocking helpers (run via asyncio.to_thread) -------------------------------------

def _acquire_vram(engine, needed_mb: int | None) -> dict:
    """Free the GPU for a *real* engine that isn't loaded yet; no-op for fakes / hot engines."""
    from animatory.genimage.zimage.engine import ZImageEngine

    if isinstance(engine, ZImageEngine) and not engine.is_loaded:
        from animatory.genimage.zimage import brain

        return brain.ensure_vram_for_zimage(needed_mb)
    return {}


def _release_gpu(engine, brain_state: dict) -> None:
    """Drop a real pipeline (so the brain's JIT wake doesn't OOM) and restore the brain."""
    from animatory.genimage.zimage.engine import ZImageEngine

    if not isinstance(engine, ZImageEngine):
        return
    if os.environ.get("ZIMAGE_RELEASE_AFTER", "1") == "1":
        engine.release()
    if brain_state:
        from animatory.genimage.zimage import brain

        brain.restore_brain(brain_state)


def _generate_and_save(engine, *, positive, negative, seed, dims, specs, out_path: Path):
    """Attach/stack LoRAs, generate, save PNG. Always unloads LoRAs afterwards (no leak)."""
    try:
        if hasattr(engine, "attach_loras"):
            engine.attach_loras(specs)  # empty list clears any prior adapters
        img, (eff_w, eff_h) = engine.generate(
            positive, seed,
            width=int(dims["width"]), height=int(dims["height"]),
            negative=negative,
            steps=int(dims["steps"]),
            guidance_scale=float(dims["cfg_scale"]),
        )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path)
        return eff_w, eff_h
    finally:
        if hasattr(engine, "unload_lora"):
            try:
                engine.unload_lora()
            except Exception:  # pragma: no cover - unload best-effort
                logger.debug("LoRA unload failed (best-effort)", exc_info=True)


# -- the job ----------------------------------------------------------------------------

async def run_job(
    store,
    engine,
    registry: LoraRegistry,
    job_id: str,
    req,
    *,
    out_dir: str | os.PathLike,
    url_prefix: str = "/outputs",
    needed_mb: int | None = None,
) -> dict:
    """Execute one generation job, recording status transitions on ``store``.

    Returns the final job record. Never raises for expected failures — they land as
    ``status=error`` with a clear message (spec §7 worker flow).
    """
    asset_type = req.asset_type.value if hasattr(req.asset_type, "value") else str(req.asset_type)
    await store.update(job_id, status="running")
    try:
        # 1. seed: explicit > stored-per-character (rigs) > fresh random
        seed = req.seed
        if seed is None and req.character_id:
            seed = await store.get_seed(req.character_id)
        if seed is None:
            seed = _new_seed()

        # 2. enhance layer
        dims = apply_defaults(req)
        positive, negative = build_prompts(req)

        # 3. resolve LoRAs up-front so an unknown name fails before any GPU work
        specs: list[tuple[str, float, str]] = []
        for lc in req.loras:
            path = registry.resolve(lc.name)  # raises LoraNotFound
            specs.append((path, lc.weight, _adapter_name(lc.name)))

        out_path = Path(out_dir) / asset_type / f"{job_id}.png"

        # 4. GPU section — serialized, blocking work off the loop
        async with _gpu_lock:
            try:
                brain_state = await asyncio.to_thread(_acquire_vram, engine, needed_mb)
            except RuntimeError as exc:
                raise VramUnavailable(str(exc)) from exc
            try:
                eff_w, eff_h = await asyncio.to_thread(
                    _generate_and_save,
                    engine,
                    positive=positive, negative=negative, seed=seed,
                    dims=dims, specs=specs, out_path=out_path,
                )
            finally:
                await asyncio.to_thread(_release_gpu, engine, brain_state)

        # 5. persist per-character seed for consistency on the next rig (spec §10)
        if req.character_id:
            await store.set_seed(req.character_id, seed)

        meta = {
            "asset_type": asset_type,
            "width": eff_w, "height": eff_h,
            "steps": int(dims["steps"]), "cfg_scale": float(dims["cfg_scale"]),
            "loras": [{"name": lc.name, "weight": lc.weight} for lc in req.loras],
        }
        image_url = f"{url_prefix.rstrip('/')}/{asset_type}/{job_id}.png"
        return await store.update(
            job_id, status="done", image_url=image_url, seed=int(seed), meta=meta, error=None,
        )

    except LoraNotFound as exc:
        return await store.update(job_id, status="error", error=f"lora: {exc}")
    except VramUnavailable as exc:
        return await store.update(job_id, status="error", error=f"vram: {exc}")
    except Exception as exc:  # noqa: BLE001 - any inference failure becomes a job error
        msg = str(exc)
        err = _oom_guidance(asset_type, msg) if _is_oom(msg) else msg
        logger.warning("imagegen job %s failed: %s", job_id, err)
        return await store.update(job_id, status="error", error=err)


# -- LoRA training (subprocess job) ----------------------------------------------------

def _read_progress(path: str | os.PathLike) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


async def _default_run_cmd(cmd: list[str]) -> tuple[int, str]:
    """Run the training subprocess to completion; return (returncode, stderr tail)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    tail = (stderr or b"").decode(errors="replace")[-2000:]
    return (proc.returncode if proc.returncode is not None else -1), tail


def _train_meta(cfg: dict, prog: dict) -> dict:
    """Job meta from config defaults overlaid with the subprocess's latest progress."""
    return {
        "name": prog.get("lora_name") or _slug(cfg["name"]),
        "step": prog.get("step", 0),
        "total": prog.get("total", cfg.get("steps")),
        "loss": prog.get("loss"),
        "lora_name": prog.get("lora_name") or _slug(cfg["name"]),
        "lora_path": prog.get("lora_path"),
    }


async def run_train_job(store, engine, job_id: str, cfg: dict, *, run_cmd=_default_run_cmd,
                        poll_s: float = 5.0) -> dict:
    """Train a character LoRA in a subprocess, tracking progress on ``store``.

    Holds the single-GPU lock for the whole run (so ``/generate`` queues behind it) and releases
    the in-process pipeline first so the subprocess has the VRAM. ``run_cmd`` is injectable for
    tests. ``cfg`` keys: name, refs_dir, trigger?, caption?, steps, rank, lr, resolution,
    strength, lora_dir, rigs_dir.
    """
    slug = _slug(cfg["name"])
    lora_dir = cfg.get("lora_dir") or os.environ.get("LORA_DIR", "loras")
    rigs_dir = cfg.get("rigs_dir", "rigs")
    prog_dir = Path(os.environ.get("ZIMAGE_OUT_DIR", "out")) / "trainings"
    prog_dir.mkdir(parents=True, exist_ok=True)
    progress_path = str(prog_dir / f"{job_id}.json")

    cmd = [
        sys.executable, "-m", "animatory.genimage.imagegen.lora_train",
        "--name", cfg["name"], "--refs", str(cfg["refs_dir"]),
        "--out", str(lora_dir), "--rigs", str(rigs_dir),
        "--steps", str(cfg.get("steps", 1500)), "--rank", str(cfg.get("rank", 8)),
        "--lr", str(cfg.get("lr", 1e-4)), "--res", str(cfg.get("resolution", 512)),
        "--strength", str(cfg.get("strength", 0.9)), "--progress", progress_path,
    ]
    if cfg.get("trigger"):
        cmd += ["--trigger", cfg["trigger"]]
    if cfg.get("caption"):
        cmd += ["--caption", cfg["caption"]]

    await store.update(job_id, status="running",
                       meta={"name": slug, "step": 0, "total": cfg.get("steps", 1500)})

    async with _gpu_lock:
        # Free the card for the subprocess: drop any resident in-process pipeline.
        from animatory.genimage.zimage.engine import ZImageEngine
        if isinstance(engine, ZImageEngine):
            engine.release()

        task = asyncio.create_task(run_cmd(cmd))
        while not task.done():
            await asyncio.sleep(poll_s)
            prog = _read_progress(progress_path)
            if prog and prog.get("status") != "error":
                await store.update(job_id, status="running", meta=_train_meta(cfg, prog))
        rc, stderr_tail = await task

    final = _read_progress(progress_path)
    if rc == 0 and final.get("status") == "done":
        return await store.update(job_id, status="done", meta=_train_meta(cfg, final), error=None)
    err = final.get("error") or stderr_tail.strip() or f"training process exited {rc}"
    logger.warning("LoRA training job %s failed: %s", job_id, err)
    return await store.update(job_id, status="error", error=err, meta=_train_meta(cfg, final))
