"""GPU-arbiter tests (brain hibernate/wake around Z-Image) — no network, no GPU."""

from __future__ import annotations

import pytest

from animatory.genimage.zimage.brain import (
    BrainClient,
    BrainConfig,
    ensure_vram_for_zimage,
    restore_brain,
)


class FakeTransport:
    """Scripted (status_code, body) responses keyed by (method, path suffix)."""

    def __init__(self, script: dict):
        self.script = script
        self.calls: list[tuple[str, str]] = []

    def __call__(self, method, url, body, timeout):
        path = "/" + url.split("/", 3)[-1]
        self.calls.append((method, path))
        return self.script.get((method, path), (404, {}))


def _client(script, *, manage=True, restore=True):
    cfg = BrainConfig(control_url="http://127.0.0.1:8089", manage=manage, restore=restore)
    return BrainClient(cfg, transport=FakeTransport(script))


def _probe_seq(values):
    """A probe that returns values in order, repeating the last one."""
    it = list(values)

    def probe():
        return it.pop(0) if len(it) > 1 else it[0]

    return probe


def test_enough_vram_means_brain_untouched():
    client = _client({})
    state = ensure_vram_for_zimage(4500, client=client, probe=_probe_seq([6000]))
    assert state == {"brain_was_running": False, "stopped": False}
    assert client._transport.calls == []  # type: ignore[attr-defined]


def test_low_vram_hibernates_brain_then_proceeds():
    client = _client({
        ("GET", "/brain/status"): (200, {"running": True, "model": "qwen4b"}),
        ("POST", "/brain/stop"): (200, {"status": "ok"}),
    })
    state = ensure_vram_for_zimage(
        4500, client=client, probe=_probe_seq([300, 6200]), wait_s=5, poll_s=0,
    )
    assert state == {"brain_was_running": True, "stopped": True}
    assert ("POST", "/brain/stop") in client._transport.calls  # type: ignore[attr-defined]


def test_policy_gated_stop_202_fails_with_guidance():
    client = _client({
        ("GET", "/brain/status"): (200, {"running": True}),
        ("POST", "/brain/stop"): (202, {"pending_id": "abc123"}),
    })
    with pytest.raises(RuntimeError) as e:
        ensure_vram_for_zimage(4500, client=client, probe=_probe_seq([300]))
    msg = str(e.value)
    assert "abc123" in msg and "approve" in msg.lower()


def test_unreachable_control_plane_low_vram_fails_with_guidance():
    client = _client({})  # 404 everywhere → status() returns None
    with pytest.raises(RuntimeError) as e:
        ensure_vram_for_zimage(4500, client=client, probe=_probe_seq([300]))
    assert "BRAIN_CONTROL_ENABLED" in str(e.value)


def test_manage_disabled_low_vram_fails_with_manual_guidance():
    client = _client({}, manage=False)
    with pytest.raises(RuntimeError) as e:
        ensure_vram_for_zimage(4500, client=client, probe=_probe_seq([300]))
    assert "manually" in str(e.value)


def test_unprobeable_and_unreachable_proceeds_optimistically():
    client = _client({})
    state = ensure_vram_for_zimage(4500, client=client, probe=lambda: None)
    assert state["stopped"] is False


def test_brain_already_sleeping_just_waits_for_vram():
    client = _client({("GET", "/brain/status"): (200, {"running": False})})
    state = ensure_vram_for_zimage(
        4500, client=client, probe=_probe_seq([300, 6000]), wait_s=5, poll_s=0,
    )
    assert state == {"brain_was_running": False, "stopped": False}
    assert ("POST", "/brain/stop") not in client._transport.calls  # type: ignore[attr-defined]


def test_stop_403_explains_loopback_remedy():
    client = _client({
        ("GET", "/brain/status"): (200, {"running": True}),
        ("POST", "/brain/stop"): (403, {}),
    })
    with pytest.raises(RuntimeError) as e:
        ensure_vram_for_zimage(4500, client=client, probe=_probe_seq([300]))
    assert "BRAIN_VIA_WSL" in str(e.value)


def test_restore_wakes_only_when_we_stopped_it():
    script = {("POST", "/brain/wake"): (200, {})}
    client = _client(script)
    assert restore_brain({"brain_was_running": True, "stopped": True}, client=client) is True
    assert ("POST", "/brain/wake") in client._transport.calls  # type: ignore[attr-defined]

    client2 = _client(script)
    assert restore_brain({"brain_was_running": False, "stopped": False}, client=client2) is False
    assert client2._transport.calls == []  # type: ignore[attr-defined]


def test_restore_respects_opt_out():
    client = _client({("POST", "/brain/wake"): (200, {})}, restore=False)
    assert restore_brain({"brain_was_running": True, "stopped": True}, client=client) is False
    assert client._transport.calls == []  # type: ignore[attr-defined]
