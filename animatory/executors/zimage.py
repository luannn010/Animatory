"""Z-Image executor — wraps the rig/shot pipeline behind the Animatory executor contract.

Two modes, dispatched from ``request.context["mode"]`` (or inferred from the agent id):

- ``build_rigs`` (Stage 1): for each entity in the Bible, write a generalized ``rig.json``
  and — when the engine is available — a canonical reference image. Hero characters declare
  ``identity_mode: lora`` (trained separately via ``train.py``); locations/items/untrained
  characters use reference + locked seed.
- ``gen_panels`` (Stage 2): load the rigs, turn enriched shots into ``Shot`` objects, run the
  batch, and return one image artifact (+ sidecar) per panel.

The engine is **injectable** and built lazily, so this executor is cheap to construct (the
server instantiates it at startup) and unit-testable without torch/GPU. When torch/diffusers
are absent, ``build_rigs`` still writes the durable ``rig.json`` contracts (skipping pixel
generation) and ``gen_panels`` reports a clear error.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path

from animatory.executors.base import AbstractExecutor
from animatory.models import AgentDef, ExecutorResult, OutputArtifact, RunRequest
from animatory.zimage.config import ZImageConfig
from animatory.zimage.rig import Rig
from animatory.zimage.runner import run_batch
from animatory.zimage.shots import Shot

logger = logging.getLogger(__name__)


def _slug(name: str) -> str:
    return "_".join(name.strip().lower().split())


def _stable_seed(name: str) -> int:
    """Deterministic seed from a name so reruns reproduce the same reference image."""
    return int(hashlib.md5(name.encode("utf-8")).hexdigest()[:8], 16)


# What the reference image of each kind should depict. Passed as the build-time "action"
# so sheet-specific directives stay OUT of the rig's style_tokens (which also ride into
# shot panels, where "white background" would fight the scene's actual background).
_REF_ACTION = {
    "character": "full body reference sheet, neutral standing pose, plain white background",
    "location": "wide establishing view",
    "item": "isolated object reference, plain neutral background",
}


def _load_all_rigs(rigs_dir: Path) -> list[Rig]:
    rigs: list[Rig] = []
    for p in sorted(Path(rigs_dir).glob("*/*/rig.json")):
        try:
            rigs.append(Rig.load(p))
        except Exception as exc:  # pragma: no cover - corrupt rig is skipped, not fatal
            logger.warning("skipping unloadable rig %s: %s", p, exc)
    return rigs


class ZImageExecutor(AbstractExecutor):
    name = "zimage"

    def __init__(self, config: ZImageConfig | None = None, engine=None) -> None:
        self.config = config or ZImageConfig()
        self._engine = engine  # injectable; lazily built when needed
        self._brain_state: dict = {}

    # -- GPU arbitration (shared 8GB card: brain LLM vs Z-Image) --------------------
    def _acquire_gpu(self, engine) -> None:
        """Before the heavy pipeline loads: free VRAM, hibernating the brain if needed."""
        from animatory.zimage.engine import ZImageEngine

        if isinstance(engine, ZImageEngine) and not engine.is_loaded:
            from animatory.zimage import brain

            self._brain_state = brain.ensure_vram_for_zimage()

    def _release_gpu(self, engine) -> None:
        """After a batch: drop the pipeline (so the brain's JIT wake doesn't OOM
        against our resident ~4.6GB) and restore the brain if we hibernated it.
        Disable with ZIMAGE_RELEASE_AFTER=0 to keep the pipeline hot between runs."""
        from animatory.zimage.engine import ZImageEngine

        if not isinstance(engine, ZImageEngine):
            return
        if os.environ.get("ZIMAGE_RELEASE_AFTER", "1") != "1":
            return
        engine.release()
        from animatory.zimage import brain

        brain.restore_brain(self._brain_state)
        self._brain_state = {}

    # -- engine -------------------------------------------------------------------
    def _engine_or_none(self):
        """The engine if injected or if torch/diffusers are importable, else None."""
        if self._engine is not None:
            return self._engine
        from animatory.zimage.engine import ZImageEngine, deps_available

        if deps_available():
            self._engine = ZImageEngine(self.config)
            return self._engine
        logger.warning("Z-Image deps unavailable; rig.json will be written without reference images.")
        return None

    # -- dispatch -----------------------------------------------------------------
    async def execute(self, request: RunRequest, definition: AgentDef) -> ExecutorResult:
        ctx = request.context or {}
        mode = ctx.get("mode") or self._infer_mode(definition)
        if mode == "build_rigs":
            return await asyncio.to_thread(self._build_rigs, ctx)
        if mode == "gen_panels":
            return await asyncio.to_thread(self._gen_panels, ctx)
        return ExecutorResult(error=f"ZImageExecutor: unknown mode '{mode}'")

    @staticmethod
    def _infer_mode(definition: AgentDef) -> str:
        ident = (definition.id or "").lower()
        if "panel" in ident or "board" in ident:
            return "gen_panels"
        return "build_rigs"

    # -- Stage 1 ------------------------------------------------------------------
    def _build_rigs(self, ctx: dict) -> ExecutorResult:
        entities = ctx.get("entities", []) or []
        rigs_dir = Path(ctx.get("rigs_dir", self.config.rigs_dir))
        engine = self._engine_or_none()
        outputs: list[OutputArtifact] = []
        built = 0
        acquired = False

        try:
            for ent in entities:
                kind = ent.get("kind")
                name = ent.get("name") or ent.get("canonical")
                if not kind or not name:
                    continue
                rig_dir = rigs_dir / kind / _slug(name)
                rig_path = rig_dir / "rig.json"
                if rig_path.exists():
                    # The rig is the durable artifact — never clobber a hand-authored/updated one.
                    rig = Rig.load(rig_path)
                    if ent.get("appears_in"):
                        rig.appears_in = sorted(set(rig.appears_in) | set(ent["appears_in"]))
                        rig.save(rig_path)
                else:
                    rig = Rig.new(
                        name, kind,
                        identity_mode=ent.get("identity_mode"),
                        fallback_seed=ent.get("fallback_seed", _stable_seed(name)),
                        appears_in=ent.get("appears_in", []),
                    )
                    rig.save(rig_path)
                outputs.append(OutputArtifact(name=f"{kind}:{name}:rig", type="file", path=str(rig_path)))
                built += 1

                # Reference image (only for non-LoRA rigs; LoRA identity comes from train.py).
                # Idempotent: an existing ref is kept (delete it to force regeneration).
                ref_path = rig_dir / "refs" / "main.png"
                if engine is not None and not rig.uses_lora and not ref_path.exists():
                    if not acquired:
                        self._acquire_gpu(engine)  # hibernate the brain before first load; aborts batch on failure
                        acquired = True
                    try:
                        gk = rig.gen_kwargs()
                        img, _ = engine.generate(rig.build_prompt(_REF_ACTION.get(kind, "")), rig.fallback_seed,
                                                 width=gk["width"], height=gk["height"], negative=gk["negative"])
                        ref_path.parent.mkdir(parents=True, exist_ok=True)
                        if hasattr(img, "save"):
                            img.save(ref_path)
                    except Exception as exc:  # pragma: no cover - generation failure is non-fatal per rig
                        logger.warning("reference image generation failed for %s: %s", name, exc)
                if ref_path.exists():
                    outputs.append(OutputArtifact(name=f"{kind}:{name}:ref", type="image", path=str(ref_path)))
        finally:
            if acquired:
                self._release_gpu(engine)

        return ExecutorResult(outputs=outputs, metrics={"rigs_built": built, "ref_images": engine is not None})

    # -- Stage 2 ------------------------------------------------------------------
    def _gen_panels(self, ctx: dict) -> ExecutorResult:
        shots_in = ctx.get("shots", []) or []
        batch_id = ctx.get("batch_id", "batch")
        rigs_dir = Path(ctx.get("rigs_dir", self.config.rigs_dir))
        out_dir = Path(ctx.get("out_dir", self.config.out_dir))
        scene_locations = ctx.get("scene_locations", {}) or {}
        items_by_shot = ctx.get("items_by_shot", {}) or {}

        engine = self._engine_or_none()
        if engine is None:
            return ExecutorResult(
                error="Z-Image engine unavailable (torch/diffusers + GPU required) for panel generation"
            )

        rigs = _load_all_rigs(rigs_dir)
        shots = [
            Shot.from_enriched(
                s,
                location=scene_locations.get(str(s.get("sceneId"))),
                items=items_by_shot.get(str(s.get("id")), []),
            )
            for s in shots_in
        ]
        self._acquire_gpu(engine)  # hibernate the brain before the pipeline loads
        try:
            result = run_batch(shots, rigs, engine, out_dir=out_dir, batch_id=batch_id)
        finally:
            self._release_gpu(engine)
        outputs = [
            OutputArtifact(name=f"panel_{sc['id']}", type="image", path=sc["png"])
            for sc in result.sidecars
        ]
        return ExecutorResult(
            outputs=outputs,
            metrics={"panels": len(result.sidecars), "lora_swaps": result.lora_swaps},
        )

    async def health_check(self) -> bool:
        from animatory.zimage.engine import deps_available

        return deps_available()
