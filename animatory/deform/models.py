"""Pydantic models for the mesh-deform surface.

snake_case in Python, camelCase JSON (matches the frontend deform types in the
page handoffs). Flat arrays for the mesh (``vertices``/``triangles``/``uvs``)
keep payloads small — the front-end uploads them straight into typed arrays.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Density = Literal["coarse", "medium", "fine"]
WeightMethod = Literal["distance-falloff", "bone-heat"]
MeshStatus = Literal["none", "generating", "rigged", "failed"]
JobStatus = Literal["queued", "running", "done", "failed"]
JobStage = Literal["triangulating", "weighting", "packing", "done"]


class _CamelModel(BaseModel):
    """Base: snake_case fields, camelCase JSON, accepts either on input."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class MeshParams(_CamelModel):
    density: Density = "medium"
    interior_points: bool = True
    weight_method: WeightMethod = "distance-falloff"


class BindBone(_CamelModel):
    """One bone's bind-pose segment, in the source PNG's pixel space (R1/R5).

    The front-end resolves these from the rig (FK ``resolveSkeleton``) and maps
    rig-canvas coords into image pixels before sending them; the backend trusts
    that the coordinates already share the texture's pixel space.
    """
    id: str
    x: float
    y: float
    tip_x: float
    tip_y: float


class GenerateMeshRequest(_CamelModel):
    params: MeshParams = MeshParams()
    bones: list[BindBone]
    # Exactly one image source (R2): a base64 data: URL, or a path under the
    # outputs dir (e.g. "rig/<jobId>.png") for art already produced by imagegen.
    image_data_url: str | None = None
    image_ref: str | None = None


class VertexWeight(_CamelModel):
    """One vertex's influences: ``bones[i]`` has weight ``values[i]``.

    ``len(bones) == len(values)``, ``len(bones) <= 4``, ``sum(values) == 1``.
    """
    bones: list[str]
    values: list[float]


class MeshData(_CamelModel):
    asset_id: str
    version: int
    vertices: list[float]                 # flat [x0,y0,x1,y1,...] image px
    triangles: list[int]                  # flat index triples
    uvs: list[float]                      # flat [u0,v0,...] in 0..1
    bind_pose: dict[str, list[float]]     # boneId -> [x, y, tipX, tipY]
    weights: list[VertexWeight]           # one per vertex, index-aligned
    texture_url: str
    status: MeshStatus
    generated_at: str | None
    params: MeshParams


class MeshJob(_CamelModel):
    job_id: str
    asset_id: str
    status: JobStatus
    progress: float = 0.0
    stage: JobStage | None = None
    error: str | None = None


class SaveWeightsRequest(_CamelModel):
    weights: list[VertexWeight]
