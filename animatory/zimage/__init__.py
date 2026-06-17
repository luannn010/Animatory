"""Z-Image Turbo rig → shot pipeline.

Two stages (see docs / zimage_rig_pipeline_mvp_spec.md):

1. **Rig creation** — build a durable, reusable identity artifact (``rig.json``) per
   entity (character / location / item). Hero characters use a trained LoRA; locations,
   items, and untrained characters use a reference image + locked seed.
2. **Shot generation** — batch-generate storyboard panels that reference rigs by name.

Modules:
- ``rig``    — the generalized ``rig.json`` contract (the durable artifact).
- ``config`` — paths, dtype, device, offload toggle, model id.
- ``engine`` — owns the ``ZImagePipeline`` (loads once; torch/diffusers are lazy imports).
- ``shots``  — adapt enriched-shot records → ``Shot`` objects + compose prompts.
- ``runner`` — the batch loop (sort by rig, generate, write png + sidecar).
- ``train``  — thin Ostris LoRA wrapper for hero characters (built last).

Only ``engine``/``train`` require torch/diffusers; everything else is pure Python so the
contract, extraction, and orchestration are testable without a GPU.
"""

from animatory.zimage.rig import Rig, KINDS, IDENTITY_MODES, KIND_STYLE_DEFAULTS

__all__ = ["Rig", "KINDS", "IDENTITY_MODES", "KIND_STYLE_DEFAULTS"]
