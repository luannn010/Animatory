"""GPU arbiter: hibernate the "brain" (workerd-managed chat LLM) before Z-Image loads.

The 8GB card is shared by two tenants — the chat LLM (llama.cpp, managed by workerd's
brain control plane) and the Z-Image engine. Neither fits beside the other, so the
executor calls :func:`ensure_vram_for_zimage` before loading the pipeline:

1. probe free VRAM (nvidia-smi); if enough is free, do nothing;
2. otherwise ask workerd's control plane (``127.0.0.1:8089``) to stop the brain and
   poll until the VRAM actually frees;
3. after the image batch, the executor releases the pipeline and (optionally) wakes
   the brain back up if it was running before.

Control-plane notes (mirrors the workerd API):
- ``POST /brain/stop`` returns **200** when policy allows, or **202 {pending_id}** when
  the ``ask-brain-stop`` policy gates it. We never auto-approve a 202 — that would
  defeat the policy; we fail with instructions instead. For unattended hibernation flip
  ``ask-brain-stop`` to ``allow`` in ``.ptolemy/policy.json`` on the brain host.
- The control plane rejects non-loopback callers (403). Windows→WSL traffic arrives
  from the NAT gateway IP, NOT loopback, so set ``BRAIN_VIA_WSL=1`` to route requests
  through ``wsl curl`` (source becomes WSL-loopback). Mirrored-networking WSL or an SSH
  tunnel also work with the default HTTP transport.

Everything is injectable (transport, probe) so the logic is unit-testable offline.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    return os.environ.get(name, "1" if default else "0") == "1"


@dataclass
class BrainConfig:
    control_url: str = os.environ.get("BRAIN_CONTROL_URL", "http://127.0.0.1:8089")
    manage: bool = field(default_factory=lambda: _env_bool("BRAIN_MANAGE", True))
    via_wsl: bool = field(default_factory=lambda: _env_bool("BRAIN_VIA_WSL", False))
    restore: bool = field(default_factory=lambda: _env_bool("BRAIN_RESTORE", True))
    timeout_s: float = float(os.environ.get("BRAIN_TIMEOUT_S", "10"))


# -- transports (callable(method, url, body|None, timeout) -> (status_code, dict)) ----

def _http_transport(method: str, url: str, body: dict | None, timeout: float):
    import httpx

    r = httpx.request(method, url, json=body, timeout=timeout)
    try:
        data = r.json() if r.content else {}
    except json.JSONDecodeError:
        data = {}
    return r.status_code, data


def _wsl_transport(method: str, url: str, body: dict | None, timeout: float):
    """Run curl inside WSL so the control plane sees a loopback source (it 403s
    the Windows NAT gateway IP that direct host→WSL requests arrive from)."""
    cmd = ["wsl", "curl", "-s", "-o", "-", "-w", "\n%{http_code}",
           "-X", method, url, "-m", str(int(timeout))]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10).stdout
    lines = out.strip().splitlines() or ["", "0"]
    code_str = lines[-1].strip()
    payload = "\n".join(lines[:-1]).strip()
    try:
        data = json.loads(payload) if payload else {}
    except json.JSONDecodeError:
        data = {}
    return (int(code_str) if code_str.isdigit() else 0), data


class BrainClient:
    """Thin client for workerd's brain control plane (status / wake / stop)."""

    def __init__(self, config: BrainConfig | None = None, transport=None) -> None:
        self.config = config or BrainConfig()
        self._transport = transport or (_wsl_transport if self.config.via_wsl else _http_transport)

    def _call(self, method: str, path: str, body: dict | None = None):
        url = self.config.control_url.rstrip("/") + path
        try:
            return self._transport(method, url, body, self.config.timeout_s)
        except Exception as exc:
            logger.debug("brain control unreachable (%s %s): %s", method, path, exc)
            return 0, {}

    def status(self) -> dict | None:
        """``{"running": bool, "model": ..., "last_use": ...}`` or None if unreachable."""
        code, data = self._call("GET", "/brain/status")
        return data if code == 200 else None

    def wake(self, model: str | None = None) -> bool:
        code, _ = self._call("POST", "/brain/wake", {"model": model} if model else {})
        return code == 200

    def stop(self) -> tuple[bool, str]:
        """Returns ``(stopped, detail)``. 202 means policy wants operator approval —
        we report it rather than auto-approving (that would defeat the policy)."""
        code, data = self._call("POST", "/brain/stop", {})
        if code == 200:
            return True, "stopped"
        if code == 202:
            pid = data.get("pending_id", "?")
            return False, (
                f"brain stop requires operator approval (pending_id={pid}). "
                f"Approve via POST 127.0.0.1:8081/approve/{pid} on the brain host, or flip "
                "'ask-brain-stop' to 'allow' in .ptolemy/policy.json for unattended hibernation."
            )
        if code == 403:
            return False, (
                "brain control returned 403 — caller is not loopback. From Windows, set "
                "BRAIN_VIA_WSL=1 (routes via `wsl curl`) or use mirrored-networking WSL / an SSH tunnel."
            )
        return False, f"brain control unreachable or error (HTTP {code})"


# -- VRAM probe ------------------------------------------------------------------------

def free_vram_mb() -> int | None:
    """Device-wide free VRAM in MiB via nvidia-smi, or None if unavailable."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip().splitlines()
        return int(out[0]) if out and out[0].strip().isdigit() else None
    except Exception:
        return None


# -- the guard ---------------------------------------------------------------------------

DEFAULT_NEEDED_MB = int(os.environ.get("ZIMAGE_VRAM_NEEDED_MB", "4500"))


def ensure_vram_for_zimage(
    needed_mb: int | None = None,
    *,
    client: BrainClient | None = None,
    probe=free_vram_mb,
    wait_s: float = 60.0,
    poll_s: float = 2.0,
) -> dict:
    """Make room for the Z-Image engine, hibernating the brain if necessary.

    Returns ``{"brain_was_running": bool, "stopped": bool}`` so the caller can restore
    the brain afterwards. Raises ``RuntimeError`` with actionable guidance when VRAM
    cannot be freed (policy gate, unreachable control plane, or a third tenant).
    """
    needed = needed_mb if needed_mb is not None else DEFAULT_NEEDED_MB
    state = {"brain_was_running": False, "stopped": False}

    free = probe()
    if free is not None and free >= needed:
        return state  # already enough room — don't touch the brain

    client = client or BrainClient()
    if not client.config.manage:
        if free is None:
            return state  # can't probe, not managing — proceed optimistically
        raise RuntimeError(
            f"only {free}MiB VRAM free (need ~{needed}MiB) and BRAIN_MANAGE=0 — "
            "stop the chat LLM manually, then retry."
        )

    st = client.status()
    if st is None:
        if free is None:
            return state  # nothing verifiable — proceed optimistically
        raise RuntimeError(
            f"only {free}MiB VRAM free (need ~{needed}MiB) and the brain control plane "
            f"({client.config.control_url}) is unreachable. Start workerd with "
            "BRAIN_CONTROL_ENABLED=true on the brain host, or stop the chat LLM manually."
        )

    if st.get("running"):
        state["brain_was_running"] = True
        ok, detail = client.stop()
        if not ok:
            raise RuntimeError(f"could not hibernate the brain: {detail}")
        state["stopped"] = True
        logger.info("brain hibernated to free VRAM for Z-Image")

    # Wait for the VRAM to actually come back (driver frees asynchronously).
    deadline = time.monotonic() + wait_s
    while True:
        free = probe()
        if free is None or free >= needed:
            return state
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"brain reported stopped but only {free}MiB VRAM free after {wait_s:.0f}s "
                f"(need ~{needed}MiB) — another process is holding the GPU."
            )
        time.sleep(poll_s)


def restore_brain(state: dict, *, client: BrainClient | None = None) -> bool:
    """Wake the brain back up if we hibernated it (and BRAIN_RESTORE allows)."""
    client = client or BrainClient()
    if not (client.config.restore and state.get("stopped") and state.get("brain_was_running")):
        return False
    ok = client.wake()
    logger.info("brain restore after Z-Image batch: %s", "woken" if ok else "wake failed (JIT wake will cover it)")
    return ok
