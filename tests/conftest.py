import os

import aiosqlite.core as _aiosqlite_core
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("ANIMATORY_FAKE_EXECUTORS", "1")
os.environ.setdefault("DB_PATH", ":memory:")
# Keep existing single-pass parser tests deterministic; two-phase tests opt in.
os.environ.setdefault("QWEN_TWO_PHASE", "0")

# aiosqlite spawns one *non-daemon* worker thread per connection
# (core.py: `Thread(target=_connection_worker_thread, ...)`). Tests create many
# short-lived stores (the FastAPI lifespan plus ad-hoc InMemoryRunStore/chat/studio
# stores) and not every one is closed, so those threads keep the interpreter alive
# and the process hangs at shutdown *after* results are printed. Daemonizing the
# worker thread at the source lets pytest shut down normally — no os._exit, no
# bypassed teardown — both locally and in CI.
_RealThread = _aiosqlite_core.Thread


class _DaemonThread(_RealThread):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("daemon", True)
        super().__init__(*args, **kwargs)


_aiosqlite_core.Thread = _DaemonThread

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
