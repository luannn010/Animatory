# animatory/parsing — transcript → scenes.
#
# Owns chunking, LLM scene extraction (beats), the canonical entity registry
# (names/aliases learned during parse), and source-line location. Downstream
# domains (enrichment, genimage, genvoice) depend on this; it depends only on
# the shared llm/ and gpu/ leaves.
