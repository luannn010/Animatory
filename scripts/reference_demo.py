"""Reference-conditioned generation: use a built rig image as the identity anchor.

Loads the businessman rig PNG and re-imagines him in a deluxe-restaurant scene via
img2img at two strengths, so we can compare identity-hold (low strength) vs scene-freedom
(high strength). Same seed as the rig for determinism.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image

from animatory.imagegen.presets import STYLE_NEGATIVE, STYLE_SPINE
from animatory.zimage.brain import free_vram_mb
from animatory.zimage.engine import ZImageEngine

RIG = "out/biz_smoke/rig/rig1.png"
OUT = Path("out/ref_demo")
SEED = 1816756510  # the rig's seed

PROMPT = (
    STYLE_SPINE
    + "the same handsome asian businessman, white tailored suit with a cravat, rectangular "
    "glasses, luxury wristwatch, smiling, sitting at a dining table talking with his business "
    "partner, deluxe fine-dining restaurant interior, warm lighting, wine glasses on the table"
)
NEG = "blurry, low detail, watermark, text, " + STYLE_NEGATIVE


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"free VRAM before: {free_vram_mb()} MiB", flush=True)
    ref = Image.open(RIG).convert("RGB")
    engine = ZImageEngine()

    for strength in (0.6, 0.75, 0.85, 0.95):
        img, (w, h) = engine.generate_img2img(
            PROMPT, ref, seed=SEED, strength=strength,
            steps=16, guidance_scale=1.6, negative=NEG,
        )
        path = OUT / f"ref_s{int(strength * 100)}.png"
        img.save(path)
        print(f"strength={strength} -> {path} ({w}x{h})", flush=True)

    engine.release()
    print(f"released. free VRAM after: {free_vram_mb()} MiB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
