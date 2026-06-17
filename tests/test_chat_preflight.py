"""Unit tests for the parse/reparse chat-availability preflight (no network)."""

from __future__ import annotations

import pytest

from animatory import scene_parser as sp
from animatory.scene_parser import ChatUnavailableError, ensure_chat_available


@pytest.fixture(autouse=True)
def _enable_preflight(monkeypatch):
    monkeypatch.setenv("CHAT_PREFLIGHT", "1")  # conftest turns it off globally


@pytest.mark.asyncio
async def test_reachable_returns_without_waking(monkeypatch):
    async def _up(endpoint, timeout_s):
        return True

    monkeypatch.setattr(sp, "_chat_reachable", _up)
    # wake must NOT be needed; make it explode if called
    monkeypatch.setattr("animatory.zimage.brain.BrainClient.wake",
                        lambda self, model=None: (_ for _ in ()).throw(AssertionError("woke when up")))
    await ensure_chat_available("http://x:9000")  # no raise


@pytest.mark.asyncio
async def test_unreachable_and_wake_fails_raises(monkeypatch):
    async def _down(endpoint, timeout_s):
        return False

    monkeypatch.setattr(sp, "_chat_reachable", _down)
    monkeypatch.setattr("animatory.zimage.brain.BrainClient.wake", lambda self, model=None: False)
    with pytest.raises(ChatUnavailableError) as e:
        await ensure_chat_available("http://x:9000", wake_wait_s=0.1, poll_s=0.01)
    assert "not reachable" in str(e.value)


@pytest.mark.asyncio
async def test_wake_brings_chat_up(monkeypatch):
    calls = {"n": 0}

    async def _flaky(endpoint, timeout_s):
        calls["n"] += 1
        return calls["n"] > 1  # down on the first probe, up after the wake

    monkeypatch.setattr(sp, "_chat_reachable", _flaky)
    monkeypatch.setattr("animatory.zimage.brain.BrainClient.wake", lambda self, model=None: True)
    await ensure_chat_available("http://x:9000", wake_wait_s=2.0, poll_s=0.01)  # no raise


@pytest.mark.asyncio
async def test_disabled_is_noop(monkeypatch):
    monkeypatch.setenv("CHAT_PREFLIGHT", "0")

    async def _boom(endpoint, timeout_s):
        raise AssertionError("must not probe when preflight disabled")

    monkeypatch.setattr(sp, "_chat_reachable", _boom)
    await ensure_chat_available("http://x:9000")  # no raise, no probe
