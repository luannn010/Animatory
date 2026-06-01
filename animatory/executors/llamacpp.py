from __future__ import annotations

import json
import logging
import os
import re

import httpx

from animatory.executors.base import AbstractExecutor
from animatory.models import AgentDef, ExecutorResult, OutputArtifact, RunRequest

logger = logging.getLogger(__name__)

_THINKING_RE = re.compile(r"<(?:think|reasoning)>.*?</(?:think|reasoning)>", re.DOTALL)


class LlamaCppExecutor(AbstractExecutor):
    name = "llamacpp"

    def __init__(self, endpoint: str | None = None, model: str | None = None, context_length: int | None = None) -> None:
        self.endpoint = (endpoint or os.environ.get("LLAMACPP_ENDPOINT", "http://localhost:8080")).rstrip("/")
        self.model = model or os.environ.get("LLAMACPP_MODEL", "local")
        self.context_length = context_length or int(os.environ.get("LLAMACPP_CONTEXT_LENGTH", "4096"))

    async def execute(self, request: RunRequest, definition: AgentDef) -> ExecutorResult:
        system_content = request.system_prompt or definition.responsibility
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": json.dumps(request.context)},
        ]

        payload: dict = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.context_length,
            "temperature": 0.3,
        }

        if definition.structured_output:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(f"{self.endpoint}/v1/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()

        raw_text = data["choices"][0]["message"]["content"]
        cleaned = _THINKING_RE.sub("", raw_text).strip()

        usage = data.get("usage", {})
        total_tokens = usage.get("total_tokens", usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0))

        if definition.structured_output:
            try:
                parsed = json.loads(cleaned)
            except json.JSONDecodeError:
                m = re.search(r"\{.*\}", cleaned, re.DOTALL)
                parsed = json.loads(m.group()) if m else {"output": cleaned}
            artifact_type, artifact_path = "json", "output.json"
        else:
            parsed = cleaned
            artifact_type, artifact_path = "text", "output.txt"

        return ExecutorResult(
            outputs=[OutputArtifact(name="output", type=artifact_type, path=artifact_path)],
            tokens=total_tokens,
            cost=0.0,
        )

    async def health_check(self) -> bool:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for path in ("/health", "/v1/models"):
                try:
                    resp = await client.get(f"{self.endpoint}{path}")
                    if resp.status_code == 200:
                        return True
                except httpx.RequestError:
                    continue
        return False
