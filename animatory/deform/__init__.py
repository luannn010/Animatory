"""Mesh-deform backend (Deform v2).

The slow, compute-heavy half of 2D mesh deformation: triangulate a character
PNG's alpha silhouette into a riggable mesh, seed per-vertex bone weights, and
persist the result behind an SSE job. Per-frame linear-blend skinning and the
weight-paint brush stay on the front-end.

See docs/superpowers/specs/2026-06-19-mesh-deform-design.md.
"""
