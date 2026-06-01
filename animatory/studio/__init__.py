"""Studio surface — project/episode production-pipeline API.

A higher-altitude resource layer over the agent pipeline. Manages projects
through four phases (parse -> pre -> vendor -> post) with an in-memory mock
store. Model-dependent steps (script parsing, voice casting) are isolated in
``providers.py`` as stubbed seams to be replaced with real model workflows.
"""
