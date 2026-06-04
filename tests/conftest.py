import os

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("ANIMATORY_FAKE_EXECUTORS", "1")
os.environ.setdefault("DB_PATH", ":memory:")
# Keep existing single-pass parser tests deterministic; two-phase tests opt in.
os.environ.setdefault("QWEN_TWO_PHASE", "0")

from animatory.server import app  # noqa: E402 — env vars must be set first


@pytest_asyncio.fixture
async def client():
    """AsyncClient with the FastAPI lifespan properly started."""
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as c:
            yield c
