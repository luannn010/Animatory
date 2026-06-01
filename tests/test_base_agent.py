"""Tests for animatory.base_agent — uses FakeExecutor and InMemoryRunStore."""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from animatory.models import (
    AgentDef,
    ExecutorResult,
    LayerEnum,
    OnFailEnum,
    OutputArtifact,
    RunStatusEnum,
    StackEnum,
)
from animatory.base_agent import BaseAgent
from animatory.executors.fake import FakeExecutor
from animatory.run_store import InMemoryRunStore


def _make_def(**overrides) -> AgentDef:
    defaults = dict(
        id="test.agent",
        name="Test Agent",
        layer=LayerEnum.execution,
        stack=StackEnum.text,
        role="Test",
        responsibility="Testing",
        timeout_s=10,
    )
    defaults.update(overrides)
    return AgentDef(**defaults)


async def _make_store() -> InMemoryRunStore:
    store = InMemoryRunStore()
    await store.init()
    return store


@pytest.mark.asyncio
async def test_run_returns_done():
    store = await _make_store()
    agent = BaseAgent(_make_def(), FakeExecutor(), store)
    from animatory.models import RunRequest
    record = await agent.run(RunRequest())
    assert record.status == RunStatusEnum.done


@pytest.mark.asyncio
async def test_run_id_stored():
    store = await _make_store()
    agent = BaseAgent(_make_def(), FakeExecutor(), store)
    from animatory.models import RunRequest
    record = await agent.run(RunRequest())
    assert record.run_id
    stored = await store.get(record.run_id)
    assert stored is not None
    assert stored.run_id == record.run_id


@pytest.mark.asyncio
async def test_attempts_incremented():
    store = await _make_store()
    agent = BaseAgent(_make_def(), FakeExecutor(), store)
    from animatory.models import RunRequest
    record = await agent.run(RunRequest())
    assert record.attempts >= 1


@pytest.mark.asyncio
async def test_outputs_populated():
    store = await _make_store()
    agent = BaseAgent(_make_def(), FakeExecutor(), store)
    from animatory.models import RunRequest
    record = await agent.run(RunRequest())
    assert len(record.outputs) > 0


@pytest.mark.asyncio
async def test_on_fail_skip_status_done():
    """With on_fail=skip and a failing executor, run ends with status=done."""
    class FailExec(FakeExecutor):
        async def execute(self, request, definition):
            raise RuntimeError("intentional failure")

    store = await _make_store()
    agent = BaseAgent(_make_def(on_fail=OnFailEnum.skip), FailExec(), store)
    from animatory.models import RunRequest
    record = await agent.run(RunRequest())
    assert record.status == RunStatusEnum.done
    assert record.error is not None
