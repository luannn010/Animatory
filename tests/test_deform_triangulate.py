"""Triangulation tests (no GPU) — animatory/deform/triangulate.py."""
from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from animatory.deform.models import MeshParams
from animatory.deform.triangulate import triangulate


def _ellipse_png(w: int = 200, h: int = 300) -> bytes:
    """An opaque ellipse on a transparent background (a stand-in character alpha)."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((30, 30, w - 30, h - 30), fill=(180, 120, 90, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _blank_png(w: int = 64, h: int = 64) -> bytes:
    buf = BytesIO()
    Image.new("RGBA", (w, h), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def test_triangulate_produces_valid_mesh():
    geo = triangulate(_ellipse_png(), MeshParams(density="medium"))
    assert geo.width == 200 and geo.height == 300
    assert geo.vertices and geo.triangles and geo.uvs
    assert len(geo.vertices) % 2 == 0
    assert len(geo.uvs) == len(geo.vertices)
    assert len(geo.triangles) % 3 == 0

    n_verts = len(geo.vertices) // 2
    assert max(geo.triangles) < n_verts and min(geo.triangles) >= 0  # indices in range
    assert all(0.0 <= u <= 1.0 for u in geo.uvs)                     # uvs normalized
    # every vertex sits inside the image bounds
    xs, ys = geo.vertices[0::2], geo.vertices[1::2]
    assert all(0.0 <= x <= 200.0 for x in xs)
    assert all(0.0 <= y <= 300.0 for y in ys)


def test_density_controls_resolution():
    coarse = triangulate(_ellipse_png(), MeshParams(density="coarse"))
    fine = triangulate(_ellipse_png(), MeshParams(density="fine"))
    assert len(fine.triangles) > len(coarse.triangles)


def test_triangulation_is_deterministic():
    png = _ellipse_png()
    a = triangulate(png, MeshParams(density="medium"))
    b = triangulate(png, MeshParams(density="medium"))
    assert a.vertices == b.vertices
    assert a.triangles == b.triangles
    assert a.uvs == b.uvs


def test_interior_points_toggle_still_meshes():
    boundary_only = triangulate(_ellipse_png(), MeshParams(density="medium", interior_points=False))
    assert boundary_only.triangles  # a valid mesh even without interior Steiner points


def test_blank_image_raises():
    with pytest.raises(ValueError):
        triangulate(_blank_png(), MeshParams())
