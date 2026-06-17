"""Prove the manual offload -> load -> release cycle with VRAM measurements.

Run AFTER stopping the chat server. Measures free VRAM at three points:
  1) after chat offload (should be high),
  2) with Z-Image resident (should drop ~4-5GB -> proves it loaded),
  3) after engine.release() (should recover -> card is free for chat restart).

We set ZIMAGE_RELEASE_AFTER=0 and inject our own engine so we can measure residency
*before* releasing it manually, making the VRAM delta visible.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["ZIMAGE_RELEASE_AFTER"] = "0"  # release manually below to show the delta

from animatory.executors.zimage import ZImageExecutor
from animatory.models import AgentDef, LayerEnum, RunRequest, StackEnum
from animatory.zimage.brain import free_vram_mb
from animatory.zimage.engine import ZImageEngine


async def main() -> int:
    print(f"1) free VRAM after chat offload : {free_vram_mb()} MiB", flush=True)

    engine = ZImageEngine()
    ex = ZImageExecutor(engine=engine)  # inject so we hold the handle to release/measure
    agent = AgentDef(id="board.panels", layer=LayerEnum.execution, stack=StackEnum.image,
                     role="proof", responsibility="proof")
    ctx = {
        "mode": "gen_panels", "batch_id": "offload_proof",
        "scene_locations": {"1": "school courtyard"},
        "shots": [{"id": "p1", "sceneId": 1, "characters": ["li wei"],
                   "action": "mid-air spinning kick, dynamic action pose"}],
    }
    res = await ex.execute(RunRequest(context=ctx), agent)
    if res.error:
        print("   GEN ERROR:", res.error, flush=True)
        return 1
    print(f"   generated: {[o.path for o in res.outputs]}", flush=True)
    print(f"2) free VRAM with Z-Image resident: {free_vram_mb()} MiB  (drop = pipeline loaded)", flush=True)

    engine.release()
    print(f"3) free VRAM after engine.release(): {free_vram_mb()} MiB  (recovered = ready for chat restart)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
