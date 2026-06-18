from __future__ import annotations

import asyncio
import logging

from animatory.runtime.executors.base import AbstractExecutor
from animatory.runtime.models import AgentDef, ExecutorResult, OutputArtifact, RunRequest, StackEnum

logger = logging.getLogger(__name__)


class FakeExecutor(AbstractExecutor):
    name = "fake"

    async def execute(self, request: RunRequest, definition: AgentDef) -> ExecutorResult:
        logger.info("FakeExecutor running for agent_id=%s", definition.id)
        await asyncio.sleep(0.05)

        if definition.stack in (StackEnum.comfyui, StackEnum.image, StackEnum.video):
            return ExecutorResult(
                outputs=[OutputArtifact(
                    name="output_frame",
                    type="image",
                    path="fake_output/frame_0001.png",
                    artifact_url="http://fake/frame_0001.png",
                )],
                gpu_seconds=1.5,
                cost=0.01,
            )

        if definition.stack in (StackEnum.text, StackEnum.orchestration):
            return ExecutorResult(
                outputs=[OutputArtifact(
                    name="breakdown",
                    type="json",
                    path="fake_output/breakdown.json",
                )],
                tokens=128,
                cost=0.0,
            )

        if definition.stack == StackEnum.audio:
            return ExecutorResult(
                outputs=[OutputArtifact(
                    name="dialogue",
                    type="audio",
                    path="fake_output/dialogue.wav",
                    artifact_url="http://fake/dialogue.wav",
                )],
                cost=0.005,
            )

        return ExecutorResult()

    async def health_check(self) -> bool:
        return True
