# animatory/chat — refine chat (tool-calling) over chapters.
#
#   engine.py  streaming chat + tool-call parsing (scene_edits / text_corrections)
#   store.py   SQLite session/message persistence
#
# Leaf domain: depends on the shared LLM transport and parsing's scene context;
# the pipeline router wires its routes.
