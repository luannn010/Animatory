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


# ── CI: force a clean process exit ───────────────────────────────────────────
# Importing the FastAPI app spins up a non-daemon aiosqlite/uvicorn thread that
# keeps the interpreter alive *after* tests finish, so the process hangs at
# shutdown (results already printed, exit code already decided). That stalls CI
# until the job times out. Gated behind PYTEST_FORCE_EXIT so local runs are
# unaffected; coverage/reports are already written by `pytest_unconfigure`.
_EXIT_STATUS = {"code": 0}


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    _EXIT_STATUS["code"] = int(exitstatus)


@pytest.hookimpl(trylast=True)
def pytest_unconfigure(config):  # noqa: ARG001
    if os.environ.get("PYTEST_FORCE_EXIT") == "1":
        import sys
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(_EXIT_STATUS["code"])
