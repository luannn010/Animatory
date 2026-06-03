# animatory/scene_parser.py
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)

_PROMPT_TEMPLATE = """\
You are a Vietnamese novel-to-animation production assistant.
Extract a complete shot list from the following chapter text.
Return ONLY valid JSON matching this schema - no explanation, no markdown:

{{
  "chunk_id": "{chunk_id}",
  "scenes": [
    {{
      "scene_id": "{chunk_id}_S01",
      "location": "string",
      "characters": ["string"],
      "shot_type": "wide | medium | close-up | insert | POV",
      "action": "string",
      "dialogue": [{{"character": "string", "line": "string"}}],
      "mood": "string"
    }}
  ]
}}

Chapter text:
---
{chunk_text}
---"""


async def parse_chunk(
    chunk_id: str,
    chunk_text: str,
    episode_id: str,
    output_dir: Path,
    qwen_endpoint: str | None = None,
    model: str | None = None,
    max_retries: int | None = None,
) -> Path:
    """Call Qwen, write {chunk_id}_scenes.json into output_dir, return its path."""
    endpoint = (qwen_endpoint or os.environ.get("QWEN_ENDPOINT", "http://localhost:1090")).rstrip("/")
    model_name = model or os.environ.get("QWEN_MODEL", "qwen3.5")
    retries = max_retries if max_retries is not None else int(os.environ.get("QWEN_MAX_RETRIES", "3"))
    timeout_s = float(os.environ.get("QWEN_TIMEOUT_S", "120"))

    # Qwen3.5 emits chain-of-thought (reasoning_content) by default, which makes
    # generation far slower and can blow past the timeout. We only want the JSON,
    # so disable thinking unless explicitly re-enabled via QWEN_ENABLE_THINKING=1.
    enable_thinking = os.environ.get("QWEN_ENABLE_THINKING", "0") == "1"

    prompt = _PROMPT_TEMPLATE.format(chunk_id=chunk_id, chunk_text=chunk_text)
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "chat_template_kwargs": {"enable_thinking": enable_thinking},
    }

    logger.info(
        "[parse_chunk] chunk=%s episode=%s endpoint=%s model=%s chars=%d retries=%d timeout=%.0fs thinking=%s",
        chunk_id, episode_id, endpoint, model_name, len(chunk_text), retries, timeout_s, enable_thinking,
    )

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
                scenes_data = json.loads(cleaned)
                logger.info("[parse_chunk] chunk=%s attempt %d/%d OK", chunk_id, attempt, retries)
                break
        except httpx.HTTPError as exc:
            # Connection/transport/HTTP-status error — the endpoint is unreachable or unhealthy.
            # repr() is used because ReadError/ConnectError stringify to an empty message.
            logger.warning(
                "[parse_chunk] chunk=%s attempt %d/%d: cannot reach Qwen at %s -> %s",
                chunk_id, attempt, retries, endpoint, repr(exc),
            )
            last_exc = exc
        except (json.JSONDecodeError, KeyError) as exc:
            # Endpoint responded but the body was not the JSON we expected.
            logger.warning(
                "[parse_chunk] chunk=%s attempt %d/%d: invalid response from Qwen -> %s",
                chunk_id, attempt, retries, repr(exc),
            )
            last_exc = exc
    else:
        if isinstance(last_exc, httpx.HTTPError):
            reason = f"could not reach Qwen endpoint {endpoint}/v1/chat/completions"
        else:
            reason = "could not parse JSON from Qwen response"
        raise ValueError(
            f"{reason} for {chunk_id} after {retries} attempts "
            f"(last error: {type(last_exc).__name__}: {last_exc})"
        ) from last_exc

    out_path = output_dir / f"{chunk_id}_scenes.json"
    result = {
        "chunk_id": chunk_id,
        "source_file": episode_id + ".txt",
        "model": model_name,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "scenes": scenes_data.get("scenes", []),
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[parse_chunk] chunk=%s wrote %s (%d scenes)", chunk_id, out_path, len(result["scenes"]))
    return out_path


ProgressFn = Callable[[int, int, str], Awaitable[None]]


async def parse_episode(
    episode_id: str,
    episode_dir: Path,
    chunk_ids: list[str] | None = None,
    qwen_endpoint: str | None = None,
    on_progress: ProgressFn | None = None,
) -> list[Path]:
    """Parse all (or selected) chunks in episode_dir. Returns list of written paths.

    If ``on_progress`` is given it is awaited with ``(done, total, chunk_id)``:
    once at the start as ``(0, total, "")`` and after each chunk completes. This
    drives the live progress bar/logs in the UI (progress == chunks done / total).
    """
    manifest_path = episode_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    chunks_to_parse = [
        c for c in manifest["chunks"]
        if chunk_ids is None or c["chunk_id"] in chunk_ids
    ]
    total = len(chunks_to_parse)

    logger.info(
        "[parse_episode] episode=%s dir=%s parsing %d/%d chunk(s)",
        episode_id, episode_dir, total, len(manifest["chunks"]),
    )
    if on_progress is not None:
        await on_progress(0, total, "")

    results = []
    for i, c in enumerate(chunks_to_parse, 1):
        logger.info(
            "[parse_episode] episode=%s chunk %d/%d (%s)",
            episode_id, i, total, c["chunk_id"],
        )
        txt_path = episode_dir / c["file"]
        chunk_text = txt_path.read_text(encoding="utf-8")
        path = await parse_chunk(
            chunk_id=c["chunk_id"],
            chunk_text=chunk_text,
            episode_id=episode_id,
            output_dir=episode_dir,
            qwen_endpoint=qwen_endpoint,
        )
        results.append(path)
        if on_progress is not None:
            await on_progress(i, total, c["chunk_id"])

    logger.info("[parse_episode] episode=%s done: wrote %d file(s)", episode_id, len(results))
    return results
