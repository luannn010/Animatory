"""LLM-assisted extraction of recurring "special items" (props) from shots.

Characters and locations fall out of the parse structurally (dialogue cues, scene
headings). Recurring *items* — "the glowing bolt", "the rusted key" — do not; they live in
free action prose and are easy to miss with pure heuristics. So we ask the already-wired
chat LLM to nominate concrete physical props, then **verify each nomination against the
actual shot text** and keep only those that genuinely recur (appear in ``min_shots`` or
more shots). The verification step makes the threshold robust no matter how the model
self-reports, and filters hallucinated props.

The HTTP call is injectable (``chat_fn``) so this is unit-testable without a live server.
"""

from __future__ import annotations

import json

import httpx

DEFAULT_CHAT_URL = "http://localhost:9000/v1/chat/completions"
DEFAULT_MODEL = "Qwen3.5-4B-Q4_K_M.gguf"

_SYSTEM = (
    "You identify recurring physical PROPS in an animation script's shot list. "
    "A prop is a concrete, handheld or set-dressing OBJECT that characters interact with "
    "(e.g. a key, a sword, a lantern, a letter). "
    "Do NOT list characters, people, animals, locations, rooms, or abstract concepts. "
    "Respond with ONLY a JSON object of the form "
    '{"items": [{"name": "<short noun phrase>", "aliases": ["<other phrasings>"], '
    '"description": "<one short visual phrase>"}]} '
    "and nothing else. Prefer objects that appear in more than one shot."
)


def _build_messages(shots: list[dict]) -> list[dict]:
    lines = []
    for s in shots:
        sid = s.get("id", "")
        action = (s.get("action") or "").strip()
        if action:
            lines.append(f"[{sid}] {action}")
    user = "Shots:\n" + "\n".join(lines)
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


def _parse_items(content: str) -> list[dict]:
    """Pull the item list out of a chat completion (tolerates fences / <think> / wrapper)."""
    t = (content or "")
    # strip a reasoning trace and markdown fences if any leaked into content
    import re
    t = re.sub(r"<think>.*?</think>", "", t, flags=re.DOTALL | re.IGNORECASE)
    t = t.replace("```json", "").replace("```", "")
    # try object first, then bare array
    for opener, closer in (("{", "}"), ("[", "]")):
        a, b = t.find(opener), t.rfind(closer)
        if a != -1 and b != -1 and b > a:
            try:
                obj = json.loads(t[a:b + 1])
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                return obj.get("items", []) or []
            if isinstance(obj, list):
                return obj
    return []


def _appears_in(name: str, aliases: list[str], shots: list[dict]) -> list[str]:
    """Shot ids whose action text mentions the item (case-insensitive substring)."""
    needles = [n.lower() for n in [name, *aliases] if n and n.strip()]
    hits: list[str] = []
    for s in shots:
        text = (s.get("action") or "").lower()
        if any(n in text for n in needles):
            hits.append(str(s.get("id", "")))
    return hits


async def _default_chat_fn(messages: list[dict], model: str, chat_url: str) -> str:
    """Real OpenAI-compatible chat call (llama.cpp); thinking off for a fast JSON answer."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(chat_url, json={
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
            "max_tokens": 512,
            "response_format": {"type": "json_object"},
        })
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def extract_recurring_items(
    shots: list[dict],
    *,
    chat_url: str = DEFAULT_CHAT_URL,
    model: str = DEFAULT_MODEL,
    min_shots: int = 2,
    chat_fn=None,
) -> list[dict]:
    """Return recurring props as ``[{name, aliases, description, appears_in}]``.

    Only items whose ``appears_in`` (verified against the shot text) has at least
    ``min_shots`` entries are returned. ``chat_fn`` may be injected for testing; it must be
    an async callable ``(messages, model, chat_url) -> content_str``.
    """
    usable = [s for s in shots if (s.get("action") or "").strip()]
    if not usable:
        return []

    fn = chat_fn or _default_chat_fn
    content = await fn(_build_messages(usable), model, chat_url)
    candidates = _parse_items(content)

    out: list[dict] = []
    seen: set[str] = set()
    for c in candidates:
        name = (c.get("name") or c.get("canonical") or "").strip()
        if not name:
            continue
        key = " ".join(name.split()).casefold()
        if key in seen:
            continue
        aliases = [a for a in (c.get("aliases") or []) if isinstance(a, str)]
        appears = _appears_in(name, aliases, usable)
        if len(appears) < min_shots:
            continue  # not actually recurring (or hallucinated) — drop it
        seen.add(key)
        out.append({
            "name": name,
            "aliases": aliases,
            "description": (c.get("description") or "").strip(),
            "appears_in": appears,
        })
    return out
