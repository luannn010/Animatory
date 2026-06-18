# animatory/genimage — image generation domain.
#
#   zimage/   the Z-Image engine, rig/shot domain model, batch runner
#   imagegen/ the HTTP API, job store and LoRA layer on top
#
# Consumes enriched descriptions via animatory.enrichment.prompts and the shared
# GPU arbiter animatory.gpu.brain; looks up canonical names from
# animatory.parsing.entity_registry. It is a downstream sink — nothing in
# parsing/enrichment imports it.
