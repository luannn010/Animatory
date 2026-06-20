"""Z-Image Turbo LoRA trainer (QLoRA on the DiT) — the subprocess the train endpoint runs.

Factored from the proven feasibility script. Runs a *correct* rectified-flow training step
(derived from ``diffusers/pipelines/z_image/pipeline_z_image.py``):

    x_t = (1-sigma)*x0 + sigma*noise ;  timestep_in = 1 - sigma ;  target = x0 - noise

(the transformer's raw output is -velocity, i.e. x0-noise). 8GB strategy: NF4-quantized
transformer (QLoRA) + grad checkpointing; the VAE and text encoder are used ONCE to precompute
latents/embeddings, then moved to CPU so only the DiT is resident during the loop.

torch/diffusers/peft/PIL are imported lazily inside ``train_lora`` so importing this module is
cheap (the package and tests don't drag in the heavy stack). Runs as a subprocess via the CLI at the
bottom; emits progress to a JSON file the parent worker polls.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from animatory.genimage.zimage.train import _slug, mark_trained

logger = logging.getLogger(__name__)

MODEL = "Tongyi-MAI/Z-Image-Turbo"
IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp")
PROGRESS_EVERY = 20


def _write_progress(path: str | None, **fields) -> None:
    """Atomically write the progress JSON the parent polls (best-effort)."""
    if not path:
        return
    try:
        tmp = Path(path).with_suffix(".tmp")
        tmp.write_text(json.dumps(fields), encoding="utf-8")
        tmp.replace(path)
    except Exception:  # pragma: no cover - progress is advisory
        logger.debug("could not write progress to %s", path, exc_info=True)


def _list_images(refs_dir: Path) -> list[Path]:
    return sorted(p for p in refs_dir.iterdir() if p.suffix.lower() in IMG_EXTS) if refs_dir.is_dir() else []


def train_lora(
    name: str,
    refs_dir: str | Path,
    *,
    lora_dir: str | Path = "loras",
    rigs_dir: str | Path = "rigs",
    trigger: str | None = None,
    caption: str | None = None,
    steps: int = 1500,
    rank: int = 8,
    lr: float = 1e-4,
    resolution: int = 512,
    strength: float = 0.9,
    progress_path: str | None = None,
) -> Path:
    """Train one character LoRA from ``refs_dir`` and install it.

    Saves ``lora_dir/<slug>.safetensors`` (so the registry resolves it by name) and
    ``mark_trained()`` copies it into the rig (``identity_mode=lora, trained=true``).
    Returns the path of the LoRA in ``lora_dir``.
    """
    slug = _slug(name)
    trig = trigger or slug
    cap = caption or f"{trig}, 2D toon character art, clean line art"
    refs = Path(refs_dir)
    images = _list_images(refs)
    if not images:
        raise FileNotFoundError(f"no training images in {refs} (expected {IMG_EXTS})")

    lora_path = Path(lora_dir) / f"{slug}.safetensors"
    _write_progress(progress_path, status="running", step=0, total=steps,
                    loss=None, lora_name=slug, lora_path=str(lora_path))

    import numpy as np
    import torch
    from diffusers import ZImagePipeline
    from diffusers.quantizers import PipelineQuantizationConfig
    from peft import LoraConfig, get_peft_model_state_dict
    from PIL import Image

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available — LoRA training needs the GPU box.")
    dev = "cuda"

    qcfg = PipelineQuantizationConfig(
        quant_backend="bitsandbytes_4bit",
        quant_kwargs={"load_in_4bit": True, "bnb_4bit_quant_type": "nf4",
                      "bnb_4bit_compute_dtype": torch.bfloat16},
        components_to_quantize=["transformer"],
    )
    pipe = ZImagePipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16, quantization_config=qcfg)
    logger.info("pipeline loaded for LoRA training '%s' (%d images)", slug, len(images))

    # 1. precompute caption embeddings, then evict the text encoder from VRAM
    pipe.text_encoder.to(dev)
    with torch.no_grad():
        cap_feats, _ = pipe.encode_prompt(cap, device=dev, do_classifier_free_guidance=False)
    cap_feats = [c.detach() for c in cap_feats]
    pipe.text_encoder.to("cpu")
    torch.cuda.empty_cache()

    # 2. precompute VAE latents x0 for every reference image, then evict the VAE
    sf, shift = pipe.vae.config.scaling_factor, pipe.vae.config.shift_factor
    pipe.vae.to(dev)
    x0s = []
    with torch.no_grad():
        for ip in images:
            img = Image.open(ip).convert("RGB").resize((resolution, resolution))
            t = torch.from_numpy(np.array(img)).float() / 127.5 - 1.0
            t = t.permute(2, 0, 1).unsqueeze(0).to(dev, torch.bfloat16)
            enc = pipe.vae.encode(t).latent_dist.sample()
            x0s.append(((enc - shift) * sf).float().cpu())
    pipe.vae.to("cpu")
    del pipe.vae
    torch.cuda.empty_cache()

    # 3. attach LoRA to the (4bit) transformer; freeze the base
    tr = pipe.transformer
    tr.to(dev)
    tr.requires_grad_(False)
    tr.add_adapter(LoraConfig(r=rank, lora_alpha=rank, init_lora_weights="gaussian",
                              target_modules=["to_q", "to_k", "to_v", "w1", "w2", "w3"]))
    if hasattr(tr, "enable_gradient_checkpointing"):
        tr.enable_gradient_checkpointing()
    lora_params = [p for p in tr.parameters() if p.requires_grad]

    opt = torch.optim.AdamW(lora_params, lr=lr)
    tr.train()
    g = torch.Generator(device=dev).manual_seed(0)
    recent: list[float] = []
    for step in range(steps):
        x0 = x0s[step % len(x0s)].to(dev)
        noise = torch.randn(x0.shape, generator=g, device=dev)
        sigma = torch.rand(1, device=dev)
        x_t = (1 - sigma) * x0 + sigma * noise
        timestep = (1 - sigma).to(torch.bfloat16)
        target = x0 - noise

        out = tr([x_t.to(torch.bfloat16).unsqueeze(2)[0]], timestep, cap_feats, return_dict=False)[0]
        pred = torch.stack(out, dim=0).squeeze(2).float()
        loss = torch.nn.functional.mse_loss(pred, target)

        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()

        recent.append(loss.item())
        recent = recent[-50:]
        if step % PROGRESS_EVERY == 0 or step == steps - 1:
            avg = sum(recent) / len(recent)
            logger.info("step %d/%d loss=%.4f avg=%.4f", step, steps, loss.item(), avg)
            _write_progress(progress_path, status="running", step=step + 1, total=steps,
                            loss=round(avg, 5), lora_name=slug, lora_path=str(lora_path))

    # 4. save in diffusers format directly as <slug>.safetensors, then install into the rig
    tr.eval()
    Path(lora_dir).mkdir(parents=True, exist_ok=True)
    ZImagePipeline.save_lora_weights(
        str(lora_dir), transformer_lora_layers=get_peft_model_state_dict(tr),
        weight_name=f"{slug}.safetensors",
    )
    try:
        mark_trained(name, lora_path, rigs_dir=rigs_dir, strength=strength,
                     train_notes=f"qlora r={rank} {resolution}px {steps}steps trigger={trig}")
    except FileNotFoundError:
        logger.warning("no rig.json for '%s' — LoRA saved to %s but not installed into a rig", name, lora_path)

    _write_progress(progress_path, status="done", step=steps, total=steps,
                    loss=round(sum(recent) / len(recent), 5), lora_name=slug, lora_path=str(lora_path))
    logger.info("LoRA training complete: %s (%d KiB)", lora_path, lora_path.stat().st_size // 1024)
    return lora_path


def _main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="Train a Z-Image character LoRA (QLoRA).")
    ap.add_argument("--name", required=True)
    ap.add_argument("--refs", required=True, help="directory of reference images")
    ap.add_argument("--out", default="loras", help="LORA_DIR to write <slug>.safetensors")
    ap.add_argument("--rigs", default="rigs")
    ap.add_argument("--trigger", default=None)
    ap.add_argument("--caption", default=None)
    ap.add_argument("--steps", type=int, default=1500)
    ap.add_argument("--rank", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--res", type=int, default=512)
    ap.add_argument("--strength", type=float, default=0.9)
    ap.add_argument("--progress", default=None)
    a = ap.parse_args(argv)
    try:
        train_lora(a.name, a.refs, lora_dir=a.out, rigs_dir=a.rigs, trigger=a.trigger,
                   caption=a.caption, steps=a.steps, rank=a.rank, lr=a.lr, resolution=a.res,
                   strength=a.strength, progress_path=a.progress)
        return 0
    except Exception as exc:  # noqa: BLE001 - surface as progress + nonzero exit for the parent
        logger.exception("LoRA training failed")
        _write_progress(a.progress, status="error", error=str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(_main())
