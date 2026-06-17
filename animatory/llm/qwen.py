# animatory/llm/qwen.py
"""Shared Qwen (llama-server / OpenAI-compatible) HTTP client.

Extracted from ``scene_parser`` so every LLM caller — parsing, enrichment,
spell-check — depends on this small module instead of the 900-line parser.
Behavior is unchanged: low-level POST with retry, chain-of-thought stripping,
and markdown-fence stripping.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)


def _qwen_env(
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> tuple[str, str, int, float, bool]:
    """Resolve Qwen connection settings from args/env.

    Returns (endpoint, model_name, retries, timeout_s, enable_thinking).
    Qwen3.5 emits chain-of-thought by default, which is slow; we disable thinking
    unless QWEN_ENABLE_THINKING=1.
    """
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))
    enable_thinking = os.environ.get("QWEN_ENABLE_THINKING", "0") == "1"
    return endpoint, model_name, retries, timeout_s, enable_thinking


async def _call_qwen(
    prompt: str,
    *,
    label: str,
    endpoint: str,
    model_name: str,
    retries: int,
    timeout_s: float,
    enable_thinking: bool,
    temperature: float = 0.2,
) -> dict:
    """POST one chat-completion, strip thinking + markdown fences, return parsed
    JSON. Retries with exponential backoff. Raises ValueError after `retries`
    attempts. `label` identifies the caller in log lines / the error message.
    `temperature` defaults to 0.2 (unchanged); callers needing near-deterministic
    output (e.g. spell-check) may pass lower."""
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "chat_template_kwargs": {"enable_thinking": enable_thinking},
    }

    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        if attempt > 1:
            await asyncio.sleep(2 ** (attempt - 1))
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(f"{endpoint}/v1/chat/completions", json=payload)
                resp.raise_for_status()
                raw = resp.json()["choices"][0]["message"]["content"]
                cleaned = _THINKING_RE.sub("", raw).strip()
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
                data = json.loads(cleaned)
                logger.info("[qwen] %s attempt %d/%d OK", label, attempt, retries)
                return data
        except httpx.HTTPError as exc:
            logger.warning(
                "[qwen] %s attempt %d/%d: cannot reach Qwen at %s -> %s",
                label, attempt, retries, endpoint, repr(exc),
            )
            # repr() is used because ReadError/ConnectError stringify to an empty message.
            last_exc = exc
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning(
                "[qwen] %s attempt %d/%d: invalid response from Qwen -> %s",
                label, attempt, retries, repr(exc),
            )
            last_exc = exc

    if isinstance(last_exc, httpx.HTTPError):
        reason = f"could not reach Qwen endpoint {endpoint}/v1/chat/completions"
    else:
        reason = "could not parse JSON from Qwen response"
    raise ValueError(
        f"{reason} for {label} after {retries} attempts "
        f"(last error: {type(last_exc).__name__}: {last_exc})"
    ) from last_exc
