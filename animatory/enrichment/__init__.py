# animatory/enrichment — prepare everything a generator needs before it runs.
#
# Turns parsed scenes into entity descriptions, voice profiles, scene summaries
# and the recurring-item bible (data enrichment), and composes the final
# generation PROMPT (prompts.py) by injecting those descriptions. Depends on
# parsing/ (entity registry) + the shared llm/; no generation-domain imports.
