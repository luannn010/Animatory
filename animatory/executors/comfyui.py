from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import pathlib
import time

import httpx

from animatory.executors.base import AbstractExecutor
from animatory.models import AgentDef, ExecutorResult, OutputArtifact, RunRequest

logger = logging.getLogger(__name__)


class ComfyUIExecutor(AbstractExecutor):
    name = "comfyui"

    def __init__(self, endpoint: str | None = None, poll_interval_s: float | None = None) -> None:
        self.endpoint = (endpoint or os.environ.get("COMFYUI_ENDPOINT", "http://localhost:8188")).rstrip("/")
        self.poll_interval_s = poll_interval_s if poll_interval_s is not None else float(os.environ.get("COMFYUI_POLL_INTERVAL_S", "2.0"))

    async def execute(self, request: RunRequest, definition: AgentDef) -> ExecutorResult:
        if not definition.workflow_files:
            raise ValueError(f"Agent '{definition.id}' has no workflow_files configured.")

        workflow_path = pathlib.Path(definition.workflow_files[0])
        if not workflow_path.is_absolute():
            workflow_path = pathlib.Path.cwd() / workflow_path

        with workflow_path.open("r", encoding="utf-8") as fh:
            workflow: dict = json.load(fh)

        workflow = self._inject_context(workflow, request)
        run_id = request.context.get("run_id", "animatory")
        start = time.monotonic()

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{self.endpoint}/prompt", json={"prompt": workflow, "client_id": run_id})
            resp.raise_for_status()
            prompt_id: str = resp.json()["prompt_id"]
            logger.info("ComfyUI prompt queued: %s", prompt_id)

        history = await self._poll_history(prompt_id)
        duration = time.monotonic() - start

        outputs = self._parse_outputs(history, prompt_id)
        gpu_seconds = float(history.get(prompt_id, {}).get("status", {}).get("execution_time") or duration)

        return ExecutorResult(outputs=outputs, gpu_seconds=gpu_seconds)

    def _inject_context(self, workflow: dict, request: RunRequest) -> dict:
        workflow = copy.deepcopy(workflow)
        for node_id, node in workflow.items():
            if not isinstance(node, dict):
                continue
            title: str = node.get("_meta", {}).get("title", "")
            if title == "Animatory:SystemPrompt":
                node.setdefault("inputs", {})["text"] = request.system_prompt
            elif title == "Animatory:Context":
                node.setdefault("inputs", {})["text"] = json.dumps(request.context)
            elif title.startswith("Animatory:"):
                key = title[len("Animatory:"):]
                if key in request.context:
                    val = request.context[key]
                    node.setdefault("inputs", {})["text"] = val if isinstance(val, str) else json.dumps(val)
        return workflow

    async def _poll_history(self, prompt_id: str) -> dict:
        deadline = time.monotonic() + 300.0
        async with httpx.AsyncClient(timeout=10.0) as client:
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError(f"ComfyUI prompt {prompt_id} did not complete within 300s.")
                try:
                    resp = await client.get(f"{self.endpoint}/history/{prompt_id}")
                    resp.raise_for_status()
                    data: dict = resp.json()
                    if prompt_id in data:
                        logger.info("ComfyUI prompt %s completed.", prompt_id)
                        return data
                except httpx.HTTPError as exc:
                    logger.warning("ComfyUI poll error: %s", exc)
                await asyncio.sleep(self.poll_interval_s)

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.endpoint}/system_stats")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    def _parse_outputs(self, history: dict, prompt_id: str) -> list[OutputArtifact]:
        artifacts: list[OutputArtifact] = []
        for node_id, node_data in history.get(prompt_id, {}).get("outputs", {}).items():
            for media_key in ("images", "videos"):
                for item in node_data.get(media_key, []):
                    filename = item.get("filename", "")
                    subfolder = item.get("subfolder", "")
                    file_type = item.get("type", "output")
                    artifact_url = f"{self.endpoint}/view?filename={filename}&subfolder={subfolder}&type={file_type}"
                    artifacts.append(OutputArtifact(
                        name=filename,
                        type="image" if media_key == "images" else "video",
                        path=f"{subfolder}/{filename}".lstrip("/"),
                        artifact_url=artifact_url,
                    ))
        return artifacts
