"""Auto-weighting: seed per-vertex bone influences.

``distance_falloff`` (the default, shipped first): each vertex's weight to a bone
is the inverse distance from the vertex to that bone's segment, raised to a power,
clamped to the nearest ``max_bones`` (<=4) and normalized to sum 1. Pure + fast.
``bone-heat`` (smoother, sparse-solve) is a later method behind the picker.

Vertices and bone segments are both in image-pixel space (R5).
"""
from __future__ import annotations

import numpy as np

from animatory.deform.models import BindBone, VertexWeight

_EPS = 1e-3
_MAX_BONES = 4


def _segment_distances(px: float, py: float, segs: np.ndarray) -> np.ndarray:
    """Distance from point (px,py) to each bone segment. ``segs``: (N,4) [ax,ay,bx,by]."""
    ax, ay, bx, by = segs[:, 0], segs[:, 1], segs[:, 2], segs[:, 3]
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    denom = abx * abx + aby * aby
    # Projection parameter t, clamped to the segment; t=0 for a zero-length bone.
    t = np.where(denom > 0.0, (apx * abx + apy * aby) / np.where(denom > 0.0, denom, 1.0), 0.0)
    t = np.clip(t, 0.0, 1.0)
    cx, cy = ax + t * abx, ay + t * aby
    return np.hypot(px - cx, py - cy)


def distance_falloff(
    vertices: list[float],
    bones: list[BindBone],
    *,
    power: float = 2.0,
    max_bones: int = _MAX_BONES,
) -> list[VertexWeight]:
    """One ``VertexWeight`` per vertex: inverse-distance to the nearest <=4 bones, normalized."""
    if not bones:
        raise ValueError("cannot auto-weight without at least one bone")
    verts = np.asarray(vertices, dtype=float).reshape(-1, 2)
    segs = np.asarray([[b.x, b.y, b.tip_x, b.tip_y] for b in bones], dtype=float)
    ids = [b.id for b in bones]
    k = min(max_bones, len(bones))

    out: list[VertexWeight] = []
    for vx, vy in verts:
        d = _segment_distances(vx, vy, segs)
        w = 1.0 / np.power(d + _EPS, power)
        top = np.argsort(w)[::-1][:k]          # nearest k bones (largest weight)
        ww = w[top]
        ww = ww / ww.sum()                     # normalize to sum 1
        out.append(VertexWeight(bones=[ids[i] for i in top], values=[float(x) for x in ww]))
    return out
