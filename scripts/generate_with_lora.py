"""Prove the trained LoRA loads via the shipped engine and changes output.

Generates the same prompt+seed WITH and WITHOUT the trained LoRA (using ZImageEngine.
attach_loras / unload_lora — the production path), so the difference is the LoRA's effect.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from animatory.zimage.brain import free_vram_mb
from animatory.zimage.engine import ZImageEngine

LORA = "rigs/character/biz_man/pytorch_lora_weights.safetensors"
PROMPT = "bizmanlora, a handsome asian businessman in a white suit with cravat and glasses, 2D toon style"
OUT = Path("out/lora_proof")
KW = dict(seed=7, width=512, height=512, steps=8, guidance_scale=1.5, negative="blurry, low detail")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"free VRAM before: {free_vram_mb()} MiB", flush=True)
    e = ZImageEngine()

    e.attach_loras([(LORA, 1.0, "bizman")])
    img, _ = e.generate(PROMPT, **KW)
    img.save(OUT / "with_lora.png")
    print("saved with_lora.png", flush=True)

    e.unload_lora()
    img2, _ = e.generate(PROMPT, **KW)
    img2.save(OUT / "without_lora.png")
    print("saved without_lora.png", flush=True)

    e.release()
    print(f"done. free VRAM after: {free_vram_mb()} MiB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
