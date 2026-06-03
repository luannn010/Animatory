# animatory/scene_refiner.py
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)

_TEXT_SYSTEM = """\
You are a meticulous Vietnamese proofreader preparing a novel chapter for
animation shot-list extraction. Scan the chapter for typos and for incorrect or
inconsistent character names. Reply to the user, then return corrections as
find/replace edits. Return ONLY valid JSON matching this schema - no markdown:

{
  "reply": "short answer to the user",
  "corrections": [
    {"find": "exact substring in the text", "replace": "corrected substring",
     "rationale": "why", "all_occurrences": true}
  ]
}
The "find" value MUST be an exact substring of the chapter text."""


def _strip(raw: str) -> str:
    cleaned = _THINKING_RE.sub("", raw).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned


async def _chat_json(system: str, user_content: str, messages: list[dict],
                     qwen_endpoint, model, max_retries) -> dict:
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))
    enable_thinking = os.environ.get("QWEN_ENABLE_THINKING", "0") == "1"

    chat = (
        [{"role": "system", "content": system}]
        + [{"role": "system", "content": user_content}]
        + [{"role": m["role"], "content": m["content"]} for m in messages]
    )
    payload = {
        "model": model_name,
        "messages": chat,
        "temperature": 0.2,
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
                return json.loads(_strip(raw))
        except httpx.HTTPError as exc:
            logger.warning("[refiner] attempt %d/%d: cannot reach Qwen at %s -> %s",
                           attempt, retries, endpoint, repr(exc))
            last_exc = exc
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("[refiner] attempt %d/%d: invalid response -> %s",
                           attempt, retries, repr(exc))
            last_exc = exc
    reason = (f"could not reach Qwen endpoint {endpoint}/v1/chat/completions"
              if isinstance(last_exc, httpx.HTTPError)
              else "could not parse JSON from Qwen response")
    raise ValueError(f"{reason} after {retries} attempts "
                     f"(last error: {type(last_exc).__name__}: {last_exc})") from last_exc


async def proofread_text(chunk_id, chunk_text, messages, *,
                         qwen_endpoint=None, model=None, max_retries=None) -> dict:
    """Return {"reply": str, "corrections": [ ... ]} from the proofreading chat."""
    user_content = f"Chapter {chunk_id} text:\n---\n{chunk_text}\n---"
    out = await _chat_json(_TEXT_SYSTEM, user_content, messages,
                           qwen_endpoint, model, max_retries)
    return {"reply": out.get("reply", ""), "corrections": out.get("corrections", [])}
