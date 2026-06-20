# animatory/runtime — the agent-framework execution engine.
#
#   models.py      Pydantic schemas (AgentDef, RunRecord, ExecutorResult, …)
#   registry.py    loads agent-framework.yaml into an AgentRegistry
#   base_agent.py  the validate → preconditions → execute → accept lifecycle
#   run_store.py   SQLite run-record persistence (+ in-memory for tests)
#   executors/     pluggable backends (comfyui · llamacpp · fake · zimage)
#
# Independent of the feature domains (parsing/enrichment/gen*); server.py wires it.
