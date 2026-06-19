"""The mesh-deform worker: triangulate → auto-weight → pack → persist.

Mirrors ``animatory.genimage.imagegen.service.run_job`` — a fire-and-forget
coroutine that drives status/stage/progress on the (in-memory) job and persists
the result to the (durable) mesh store. CPU-bound steps run via
``asyncio.to_thread`` so the event loop stays responsive. Never raises to the
caller: expected failures land as ``status=failed`` with a message (spec §5).
"""
from __future__ import annotations

import asyncio
import datetime
import logging

from animatory.deform.models import BindBone, MeshData, MeshParams
from animatory.deform.store import MeshJobStore, MeshStore
from animatory.deform.triangulate import triangulate
from animatory.deform.weights import distance_falloff

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


async def run_mesh_job(
    mesh_store: MeshStore,
    jobs: MeshJobStore,
    job_id: str,
    asset_id: str,
    image_bytes: bytes,
    bones: list[BindBone],
    params: MeshParams,
    *,
    texture_url: str,
) -> MeshData | None:
    """Run one mesh-generation job, recording progress on ``jobs`` and persisting to ``mesh_store``."""
    try:
        jobs.update(job_id, status="running", stage="triangulating", progress=0.05)
        geo = await asyncio.to_thread(triangulate, image_bytes, params)
        jobs.update(job_id, stage="triangulating", progress=0.5)

        jobs.update(job_id, stage="weighting", progress=0.55)
        # bone-heat is a later method; distance-falloff seeds both for now.
        weights = await asyncio.to_thread(distance_falloff, geo.vertices, bones)
        jobs.update(job_id, stage="weighting", progress=0.9)

        jobs.update(job_id, stage="packing", progress=0.95)
        version = await mesh_store.current_version(asset_id) + 1
        data = MeshData(
            asset_id=asset_id,
            version=version,
            vertices=geo.vertices,
            triangles=geo.triangles,
            uvs=geo.uvs,
            bind_pose={b.id: [b.x, b.y, b.tip_x, b.tip_y] for b in bones},
            weights=weights,
            texture_url=texture_url,
            status="rigged",
            generated_at=_now(),
            params=params,
        )
        await mesh_store.save(data)
        jobs.update(job_id, status="done", stage="done", progress=1.0, error=None)
        return data
    except Exception as exc:  # noqa: BLE001 — degrade to a failed job, never crash the loop
        logger.warning("[deform] mesh job %s for asset %s failed: %r", job_id, asset_id, exc)
        await mesh_store.set_status(asset_id, "failed")
        jobs.update(job_id, status="failed", error=str(exc))
        return None
    finally:
        jobs.clear_active(asset_id)
