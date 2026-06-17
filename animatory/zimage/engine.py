"""The generation engine — owns the ``ZImagePipeline``.

Critical design rule (spec §2/§3): **load the base model once, swap LoRA, never reload the
base.** ``torch`` and ``diffusers`` are imported lazily inside methods so importing this
module (and the executor that wraps it) costs nothing on a machine without a GPU — the pure
orchestration in ``runner``/``shots`` and the rig contract stay testable. ``deps_available``
lets callers degrade gracefully when the heavy stack is absent.
"""

from __future__ import annotations

import importlib.util
import logging

from animatory.zimage.config import ZImageConfig

logger = logging.getLogger(__name__)


def deps_available() -> bool:
    """True if torch + diffusers are importable (does not check for an actual GPU)."""
    return (
        importlib.util.find_spec("torch") is not None
        and importlib.util.find_spec("diffusers") is not None
    )


def _snap32(x: int) -> int:
    """Floor to a multiple of 32 (Z-Image floors internally; we snap so sidecars are truthful)."""
    return max(32, (int(x) // 32) * 32)


class ZImageEngine:
    """Resident Z-Image pipeline with hot-swappable LoRA adapters."""

    def __init__(self, config: ZImageConfig | None = None) -> None:
        self.config = config or ZImageConfig()
        self._pipe = None
        self._i2i = None  # ZImageImg2ImgPipeline, built lazily for reference conditioning
        self._current_lora: str | None = None

    # -- lifecycle ----------------------------------------------------------------
    def _load_pipe(self, pipe_cls):
        """Load any Z-Image pipeline class with the shared NF4-quant + CPU-offload profile.

        Used for both the base text->image pipeline and the img2img (reference) pipeline so
        they get identical 8GB-fit treatment. They are separate resident pipelines — only
        load the one you use (the reference script never loads the base, and vice versa).
        """
        if not deps_available():
            raise RuntimeError(
                "Z-Image engine requires torch + diffusers (and an 8GB+ GPU). "
                "They are not installed in this environment — run on the GPU box, "
                "or use ANIMATORY_FAKE_EXECUTORS=1 to exercise the wiring without generation."
            )
        import torch  # noqa: WPS433 (lazy by design)

        dtype = getattr(torch, self.config.dtype, torch.bfloat16)
        logger.info("Loading %s model=%s dtype=%s quant=%s offload=%s",
                    pipe_cls.__name__, self.config.model, self.config.dtype,
                    self.config.quant, self.config.offload_mode)

        load_kwargs: dict = {"torch_dtype": dtype}
        if self.config.quant == "bnb4":
            # The 6B DiT in bf16 (~12GB) exceeds an 8GB card even with model-level offload;
            # NF4-quantize the transformer (~3.5GB) so it fits (the spec's fp8-class profile).
            from diffusers.quantizers import PipelineQuantizationConfig  # type: ignore

            load_kwargs["quantization_config"] = PipelineQuantizationConfig(
                quant_backend="bitsandbytes_4bit",
                quant_kwargs={
                    "load_in_4bit": True,
                    "bnb_4bit_quant_type": "nf4",
                    "bnb_4bit_compute_dtype": dtype,
                },
                components_to_quantize=["transformer"],
            )

        pipe = pipe_cls.from_pretrained(self.config.model, **load_kwargs)
        if self.config.offload_mode == "sequential":
            pipe.enable_sequential_cpu_offload()   # slowest, lowest VRAM floor
        elif self.config.cpu_offload:
            pipe.enable_model_cpu_offload()        # 8GB-critical (spec §3)
        return pipe

    def _ensure_pipe(self):
        if self._pipe is None:
            from diffusers import ZImagePipeline  # type: ignore

            self._pipe = self._load_pipe(ZImagePipeline)
        return self._pipe

    def _ensure_i2i(self):
        if self._i2i is None:
            from diffusers import ZImageImg2ImgPipeline  # type: ignore

            self._i2i = self._load_pipe(ZImageImg2ImgPipeline)
        return self._i2i

    async def health_check(self) -> bool:
        return deps_available()

    @property
    def is_loaded(self) -> bool:
        return self._pipe is not None

    def release(self) -> None:
        """Drop the pipeline and return its VRAM — the engine-side "hibernate".

        On a shared 8GB card the resident pipeline (~4.6GB) would otherwise starve the
        chat LLM's JIT wake. The next generate() transparently reloads (~40s)."""
        if self._pipe is None and self._i2i is None:
            return
        pipe, i2i = self._pipe, self._i2i
        self._pipe = None
        self._i2i = None
        self._current_lora = None
        del pipe, i2i
        import gc

        gc.collect()
        try:
            import torch  # noqa: WPS433

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # pragma: no cover - torch absent or no CUDA
            pass
        logger.info("Z-Image pipeline released (VRAM freed)")

    # -- LoRA ---------------------------------------------------------------------
    def attach_lora(self, lora_path: str, strength: float = 0.9) -> None:
        if self._current_lora == lora_path:
            return
        pipe = self._ensure_pipe()
        if self._current_lora is not None:
            pipe.unload_lora_weights()
        pipe.load_lora_weights(lora_path)
        try:
            pipe.set_adapters(["default"], adapter_weights=[strength])
        except Exception:  # pragma: no cover - adapter naming varies by diffusers version
            logger.debug("set_adapters not applied; using default strength")
        self._current_lora = lora_path

    def unload_lora(self) -> None:
        if self._current_lora is None:
            return
        self._ensure_pipe().unload_lora_weights()
        self._current_lora = None

    def attach_loras(self, specs: list[tuple[str, float, str]]) -> None:
        """Load + **stack** multiple LoRAs (BACKEND_SPEC.md §6).

        ``specs`` is ``[(path, weight, adapter_name)]``. Loads each adapter by name then blends
        them via ``set_adapters``. Always clears any previously loaded LoRA first so weights
        never leak between jobs — pair with ``unload_lora()`` in the caller's ``finally``.
        Passing an empty list is a no-op that still clears prior adapters.
        """
        pipe = self._ensure_pipe()
        # Clear whatever was loaded before (single- or multi-LoRA) so jobs don't leak.
        if self._current_lora is not None:
            pipe.unload_lora_weights()
            self._current_lora = None
        if not specs:
            return
        names = [name for _, _, name in specs]
        weights = [float(weight) for _, weight, _ in specs]
        for path, _, name in specs:
            pipe.load_lora_weights(path, adapter_name=name)
        pipe.set_adapters(names, adapter_weights=weights)
        # Mark as a composite so unload_lora() will clear it.
        self._current_lora = "+".join(names)

    # -- generate -----------------------------------------------------------------
    def generate(self, prompt: str, seed: int, *, width: int = 512, height: int = 768,
                 negative: str = "", steps: int | None = None,
                 guidance_scale: float | None = None, **_: object):
        """Return ``(PIL.Image, (effective_w, effective_h))``. Same seed+prompt+LoRA ⇒ identical.

        ``steps``/``guidance_scale`` override the config defaults when supplied (the imagegen
        presets pass per-asset values); the rig runner omits them and keeps the config defaults.
        """
        import torch  # noqa: WPS433

        pipe = self._ensure_pipe()
        w, h = _snap32(width), _snap32(height)
        generator = torch.Generator(device=self.config.device).manual_seed(int(seed))
        result = pipe(
            prompt=prompt,
            negative_prompt=negative or None,
            num_inference_steps=self.config.steps if steps is None else int(steps),
            guidance_scale=self.config.guidance_scale if guidance_scale is None else float(guidance_scale),
            width=w,
            height=h,
            generator=generator,
        )
        return result.images[0], (w, h)

    def generate_img2img(self, prompt: str, image, seed: int, *, strength: float = 0.6,
                         width: int | None = None, height: int | None = None,
                         negative: str = "", steps: int | None = None,
                         guidance_scale: float | None = None):
        """Reference-conditioned generation: re-imagine ``image`` toward ``prompt``.

        ``strength`` in (0,1] is how far to move from the reference — low keeps the rig's
        identity/composition, high gives the prompt more freedom. Returns
        ``(PIL.Image, (effective_w, effective_h))``. Output size defaults to the reference's.
        """
        import torch  # noqa: WPS433

        pipe = self._ensure_i2i()
        if width is None or height is None:
            width, height = image.size  # match the reference plate by default
        w, h = _snap32(width), _snap32(height)
        if image.size != (w, h):
            image = image.resize((w, h))
        generator = torch.Generator(device=self.config.device).manual_seed(int(seed))
        result = pipe(
            prompt=prompt,
            image=image,
            strength=float(strength),
            negative_prompt=negative or None,
            num_inference_steps=self.config.steps if steps is None else int(steps),
            guidance_scale=self.config.guidance_scale if guidance_scale is None else float(guidance_scale),
            width=w,
            height=h,
            generator=generator,
        )
        return result.images[0], (w, h)
