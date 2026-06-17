"""LoRA-training FEASIBILITY proof on the 8GB box (Z-Image Turbo, QLoRA on the DiT).

Goal: prove this machine can actually train + save + reload a Z-Image LoRA — NOT to produce a
polished character (too few images / steps for that). It runs a *correct* rectified-flow
training step derived from the pipeline source:
  x_t = (1-sigma)*x0 + sigma*noise ;  timestep_in = 1 - sigma ;  target = x0 - noise
(the transformer's raw output is -velocity, i.e. x0-noise; see pipeline_z_image.py).

8GB strategy: NF4-quantized transformer (QLoRA) + grad checkpointing; the VAE and text
encoder are used ONCE to precompute latents/embeddings, then evicted so only the DiT is
resident during the loop.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch
from PIL import Image

from animatory.zimage.brain import free_vram_mb

MODEL = "Tongyi-MAI/Z-Image-Turbo"
TRIGGER = "bizmanlora"
PROMPT = f"{TRIGGER}, a handsome asian businessman in a white suit with cravat and glasses, 2D toon style"
IMAGES = ["out/biz_smoke/rig/rig1.png", "out/ref_demo/ref_s50.png", "out/ref_demo/ref_s70.png"]
RES = 512
STEPS = 120
RANK = 8
LR = 1e-4
OUT_DIR = Path("rigs/character/biz_man")          # where the LoRA lands
LORA_FILE = OUT_DIR / "pytorch_lora_weights.safetensors"
PROOF_IMG = Path("out/lora_proof/with_lora.png")


def log(*a):
    print(*a, flush=True)


def main() -> int:
    dev = "cuda"
    log(f"free VRAM before: {free_vram_mb()} MiB")

    from diffusers import ZImagePipeline
    from diffusers.quantizers import PipelineQuantizationConfig

    qcfg = PipelineQuantizationConfig(
        quant_backend="bitsandbytes_4bit",
        quant_kwargs={"load_in_4bit": True, "bnb_4bit_quant_type": "nf4",
                      "bnb_4bit_compute_dtype": torch.bfloat16},
        components_to_quantize=["transformer"],
    )
    pipe = ZImagePipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16, quantization_config=qcfg)
    log("pipeline loaded")

    # --- 1. precompute text embeddings (then evict the text encoder) ---
    pipe.text_encoder.to(dev)
    with torch.no_grad():
        cap_feats, _ = pipe.encode_prompt(PROMPT, device=dev, do_classifier_free_guidance=False)
    cap_feats = [c.detach() for c in cap_feats]   # list[[seq,dim]] bf16 on cuda
    pipe.text_encoder.to("cpu")                    # evict from VRAM but KEEP it (final generate needs it)
    torch.cuda.empty_cache()
    log(f"text embeds: {len(cap_feats)} x {tuple(cap_feats[0].shape)}; free VRAM {free_vram_mb()} MiB")

    # --- 2. precompute VAE latents x0 for each image (then evict the VAE) ---
    sf = pipe.vae.config.scaling_factor
    shift = pipe.vae.config.shift_factor
    pipe.vae.to(dev)
    x0s = []
    with torch.no_grad():
        for ip in IMAGES:
            img = Image.open(ip).convert("RGB").resize((RES, RES))
            t = (torch.from_numpy(__import__("numpy").array(img)).float() / 127.5 - 1.0)
            t = t.permute(2, 0, 1).unsqueeze(0).to(dev, torch.bfloat16)   # [1,3,H,W]
            enc = pipe.vae.encode(t).latent_dist.sample()
            x0 = (enc - shift) * sf
            x0s.append(x0.float().cpu())
    pipe.vae.to("cpu")
    del pipe.vae
    torch.cuda.empty_cache()
    log(f"vae latents: {len(x0s)} x {tuple(x0s[0].shape)}; free VRAM {free_vram_mb()} MiB")

    # --- 3. add LoRA to the (4bit) transformer; freeze base ---
    from peft import LoraConfig, get_peft_model_state_dict

    tr = pipe.transformer
    tr.to(dev)
    tr.requires_grad_(False)
    tr.add_adapter(LoraConfig(
        r=RANK, lora_alpha=RANK, init_lora_weights="gaussian",
        target_modules=["to_q", "to_k", "to_v", "w1", "w2", "w3"],
    ))
    if hasattr(tr, "enable_gradient_checkpointing"):
        tr.enable_gradient_checkpointing()
    lora_params = [p for p in tr.parameters() if p.requires_grad]
    n_lora = sum(p.numel() for p in lora_params)
    log(f"LoRA params: {n_lora:,} trainable; free VRAM {free_vram_mb()} MiB")

    opt = torch.optim.AdamW(lora_params, lr=LR)
    tr.train()
    g = torch.Generator(device=dev).manual_seed(0)
    losses = []
    for step in range(STEPS):
        x0 = x0s[step % len(x0s)].to(dev)                    # [1,16,h,w] float32
        noise = torch.randn(x0.shape, generator=g, device=dev)
        sigma = torch.rand(1, device=dev)                    # U(0,1)
        x_t = (1 - sigma) * x0 + sigma * noise
        timestep = (1 - sigma).to(torch.bfloat16)            # pipeline feeds 1-sigma
        target = (x0 - noise)                                # transformer raw target

        lat_in = [x_t.to(torch.bfloat16).unsqueeze(2)[0]]    # list of [C,1,h,w]
        out = tr(lat_in, timestep, cap_feats, return_dict=False)[0]
        pred = torch.stack(out, dim=0).squeeze(2).float()    # [1,16,h,w]
        loss = torch.nn.functional.mse_loss(pred, target)

        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        losses.append(loss.item())
        if step % 20 == 0 or step == STEPS - 1:
            recent = sum(losses[-20:]) / len(losses[-20:])
            log(f"step {step:3d}/{STEPS}  loss={loss.item():.4f}  avg20={recent:.4f}")

    log(f"training done. first-20 avg={sum(losses[:20])/20:.4f}  last-20 avg={sum(losses[-20:])/20:.4f}")

    # --- 4. save LoRA in diffusers format ---
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tr.eval()
    lora_sd = get_peft_model_state_dict(tr)
    ZImagePipeline.save_lora_weights(str(OUT_DIR), transformer_lora_layers=lora_sd)
    saved = list(OUT_DIR.glob("*.safetensors"))
    log(f"saved LoRA: {[str(s) for s in saved]} "
        f"({sum(s.stat().st_size for s in saved)//1024} KiB)")

    # --- 5. reload proof: drop training adapter, load the saved file back, generate ---
    try:
        tr.delete_adapters(tr.active_adapters() if callable(getattr(tr, "active_adapters", None)) else "default")
    except Exception as e:  # noqa: BLE001
        log(f"(adapter cleanup note: {e})")
    pipe.load_lora_weights(str(OUT_DIR))
    log("LoRA reloaded into pipeline via load_lora_weights() — round-trip OK")

    pipe.text_encoder.to(dev)                      # bring the encoder back for the proof generate
    PROOF_IMG.parent.mkdir(parents=True, exist_ok=True)
    with torch.no_grad():
        img = pipe(PROMPT, height=512, width=512, num_inference_steps=8,
                   guidance_scale=1.5, generator=torch.Generator(device=dev).manual_seed(7)).images[0]
    img.save(PROOF_IMG)
    log(f"generated with reloaded LoRA -> {PROOF_IMG}; free VRAM {free_vram_mb()} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
