"""Triangulate a character PNG's alpha silhouette into a 2D mesh.

Pipeline (R4 — no `triangle` C extension): alpha mask → marching-squares outline
(`skimage`) → Douglas–Peucker simplify (`shapely`) → interior grid points →
Delaunay (`scipy`) → keep triangles whose centroid is inside the outline. The
centroid filter is a constrained-Delaunay stand-in: it drops triangles that span
concavities/holes. Deterministic for a given image + params.

Coordinates are in the source PNG's pixel space; UVs are positions / image size.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image
from scipy.ndimage import label
from scipy.spatial import Delaunay
from shapely.geometry import Point, Polygon
from skimage import measure

from animatory.deform.models import MeshParams

# density → (interior grid step px, outline-simplify tolerance px)
_DENSITY: dict[str, tuple[float, float]] = {
    "coarse": (44.0, 4.0),
    "medium": (28.0, 2.5),
    "fine": (16.0, 1.5),
}


@dataclass
class MeshGeometry:
    vertices: list[float]   # flat [x0,y0,x1,y1,...] image px
    triangles: list[int]    # flat index triples
    uvs: list[float]        # flat [u0,v0,...] in 0..1
    width: int
    height: int


def _foreground_mask(img: Image.Image) -> np.ndarray:
    """Boolean foreground mask.

    Uses the alpha channel when the image actually carries transparency. Otherwise
    (e.g. a Z-Image render on an opaque background) derives the silhouette by
    flood-keying the background: pixels close in colour to the image corners AND
    connected to the border are background; everything else is foreground. Falls
    back to the whole frame if keying can't find a uniform background.
    """
    if "A" in img.getbands():
        alpha = np.asarray(img.split()[-1])
        if (alpha < 250).mean() > 0.02:  # genuine transparency present
            return alpha > 127

    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w = rgb.shape[:2]
    corners = np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    bg = np.median(corners, axis=0)
    near_bg = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) < 44.0

    labels, _ = label(near_bg)
    border = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border.discard(0)
    background = np.isin(labels, list(border)) if border else np.zeros_like(near_bg)
    fg = ~background
    if not (0.01 < fg.mean() < 0.999):  # keying failed → mesh the whole frame
        return np.ones((h, w), dtype=bool)
    return fg


def _contour_polygons(mask: np.ndarray) -> list[Polygon]:
    """Marching-squares outline(s) of *mask*, as valid shapely polygons (x, y)."""
    # Pad by 1 so a silhouette touching the image edge still yields a closed loop.
    padded = np.pad(mask.astype(float), 1, mode="constant", constant_values=0.0)
    polys: list[Polygon] = []
    for c in measure.find_contours(padded, 0.5):
        # find_contours returns (row, col); undo the pad and swap to (x, y).
        xy = np.column_stack([c[:, 1] - 1.0, c[:, 0] - 1.0])
        if len(xy) < 4:
            continue
        p = Polygon(xy)
        if not p.is_valid:
            p = p.buffer(0)  # repair self-touching loops
        if p.is_empty:
            continue
        if p.geom_type == "Polygon":
            polys.append(p)
        elif p.geom_type == "MultiPolygon":
            polys.extend(g for g in p.geoms)
    return [p for p in polys if p.area > 1.0]


def triangulate(image_bytes: bytes, params: MeshParams) -> MeshGeometry:
    """Mesh the opaque silhouette of a PNG. Raises ValueError on an unmeshable image."""
    img = Image.open(BytesIO(image_bytes)).convert("RGBA")
    width, height = img.size
    mask = _foreground_mask(img)
    if not mask.any():
        raise ValueError("image has no opaque silhouette to mesh")

    polys = _contour_polygons(mask)
    if not polys:
        raise ValueError("could not trace a silhouette contour")
    poly = max(polys, key=lambda p: p.area)  # outer silhouette (MVP: holes ignored)

    step, tol = _DENSITY[params.density]
    simple = poly.simplify(tol, preserve_topology=True)
    if simple.is_empty or simple.geom_type != "Polygon":
        simple = poly
    boundary = np.asarray(simple.exterior.coords)[:-1]  # drop the closing duplicate

    point_groups = [boundary]
    if params.interior_points:
        minx, miny, maxx, maxy = simple.bounds
        interior = [
            (x, y)
            for y in np.arange(miny + step, maxy, step)
            for x in np.arange(minx + step, maxx, step)
            if simple.contains(Point(x, y))
        ]
        if interior:
            point_groups.append(np.asarray(interior))

    points = np.vstack(point_groups)
    if len(points) < 3:
        raise ValueError("not enough vertices to triangulate")

    tri = Delaunay(points)
    kept = [
        (a, b, c)
        for a, b, c in tri.simplices
        if simple.contains(
            Point(
                (points[a, 0] + points[b, 0] + points[c, 0]) / 3.0,
                (points[a, 1] + points[b, 1] + points[c, 1]) / 3.0,
            )
        )
    ]
    if not kept:
        raise ValueError("triangulation produced no interior triangles")

    # Reindex to only the vertices actually used by a kept triangle.
    used = sorted({i for t in kept for i in t})
    remap = {old: new for new, old in enumerate(used)}
    verts = points[used]
    vertices = verts.reshape(-1).astype(float).tolist()
    triangles = [remap[i] for t in kept for i in t]
    uvs = (verts / np.array([float(width), float(height)])).reshape(-1).tolist()
    return MeshGeometry(vertices=vertices, triangles=triangles, uvs=uvs, width=width, height=height)
