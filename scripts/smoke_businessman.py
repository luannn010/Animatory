"""Real-GPU smoke test of the imagegen pipeline (BACKEND_SPEC.md path).

Generates a character RIG, then reuses the SAME character (via seed-per-character) on a
restaurant SHOT, so we can eyeball identity consistency. Runs the real `run_job` worker so
this exercises the shipped code, not a bespoke driver.

Engine is kept hot between the two jobs (ZIMAGE_RELEASE_AFTER=0) and released at the end.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["ZIMAGE_RELEASE_AFTER"] = "0"  # keep the pipeline resident across both jobs

from animatory.imagegen.jobs import ImageJobStore
from animatory.imagegen.lora import LoraRegistry
from animatory.imagegen.schemas import GenerationRequest
from animatory.imagegen.service import run_job
from animatory.zimage.brain import free_vram_mb
from animatory.zimage.engine import ZImageEngine

OUT = "out/biz_smoke"
CHAR = "biz_man"

RIG_PROMPT = (
    "handsome asian businessman around 32 years old, sharp jawline, neat black hair, "
    "rectangular glasses, crisp white tailored suit with a cravat, luxury wristwatch on his wrist, "
    "holding a leather briefcase, confident calm expression, studio lighting"
)
SHOT_PROMPT = (
    "the same handsome asian businessman, 32 years old, white tailored suit with a cravat, "
    "rectangular glasses, luxury wristwatch, sitting at a dining table eating and talking with his "
    "business partner across the table, deluxe fine-dining restaurant interior, warm ambient "
    "lighting, plates and wine glasses on the table, two men in conversation"
)


async def main() -> int:
    print(f"free VRAM before: {free_vram_mb()} MiB", flush=True)
    store = ImageJobStore(":memory:")
    await store.init()
    engine = ZImageEngine()
    reg = LoraRegistry("loras")

    # 1) RIG — no seed given, so the worker picks one and stores it under CHAR.
    await store.create("rig1", status="queued", asset_type="rig", character_id=CHAR)
    rec1 = await run_job(
        store, engine, reg, "rig1",
        GenerationRequest(asset_type="rig", prompt=RIG_PROMPT, character_id=CHAR),
        out_dir=OUT,
    )
    print(f"RIG : status={rec1['status']} seed={rec1.get('seed')} "
          f"err={rec1.get('error')} -> {rec1.get('image_url')}", flush=True)
    if rec1["status"] != "done":
        return 1

    # 2) SHOT — same CHAR, no seed -> reuses the rig's stored seed (consistency test).
    await store.create("shot1", status="queued", asset_type="shot", character_id=CHAR)
    rec2 = await run_job(
        store, engine, reg, "shot1",
        GenerationRequest(asset_type="shot", prompt=SHOT_PROMPT, character_id=CHAR),
        out_dir=OUT,
    )
    print(f"SHOT: status={rec2['status']} seed={rec2.get('seed')} "
          f"err={rec2.get('error')} -> {rec2.get('image_url')}", flush=True)

    print(f"seed reused across rig+shot: {rec1.get('seed') == rec2.get('seed')}", flush=True)
    engine.release()
    print(f"released. free VRAM after: {free_vram_mb()} MiB", flush=True)
    return 0 if rec2["status"] == "done" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
