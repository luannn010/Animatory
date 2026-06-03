from __future__ import annotations

import asyncio
import datetime
import logging
import uuid

from fastapi import HTTPException

from animatory.models import (
    AgentDef,
    BackoffEnum,
    ExecutorResult,
    OnFailEnum,
    RunRecord,
    RunRequest,
    RunStatusEnum,
)
from animatory.run_store import RunStore
from animatory.executors.base import AbstractExecutor

logger = logging.getLogger(__name__)


class BaseAgent:
    def __init__(
        self,
        definition: AgentDef,
        executor: AbstractExecutor,
        store: RunStore,
    ) -> None:
        self.definition = definition
        self.executor = executor
        self.store = store
        self._run_id: str | None = None

    @property
    def run_id(self) -> str | None:
        return self._run_id

    async def run(self, request: RunRequest) -> RunRecord:
        run_id = str(uuid.uuid4())
        self._run_id = run_id
        now = datetime.datetime.now(datetime.timezone.utc)

        record = RunRecord(
            run_id=run_id,
            agent_id=self.definition.id,
            status=RunStatusEnum.queued,
            started_at=now,
            episode_id=request.context.get("episode_id"),
            phase=request.context.get("phase"),
            track=request.context.get("track"),
        )
        await self.store.create(record)

        # Validate required inputs
        required = [inp.name for inp in self.definition.inputs if inp.required]
        missing = [name for name in required if name not in request.context]
        if missing:
            record.status = RunStatusEnum.failed
            record.error = f"Missing required inputs: {missing}"
            record.finished_at = datetime.datetime.now(datetime.timezone.utc)
            await self.store.update(run_id, status=RunStatusEnum.failed, error=record.error, finished_at=record.finished_at)
            raise ValueError(f"Agent '{self.definition.id}' missing required inputs: {missing}")

        # Check preconditions
        for cond in self.definition.preconditions:
            if not self._check_precondition(cond, request.context):
                record.status = RunStatusEnum.failed
                record.error = f"Precondition failed: {cond}"
                record.finished_at = datetime.datetime.now(datetime.timezone.utc)
                await self.store.update(run_id, status=RunStatusEnum.failed, error=record.error, finished_at=record.finished_at)
                return await self._handle_on_fail(record)

        max_attempts = max(self.definition.retry.max_attempts, 1)
        result: ExecutorResult | None = None

        for attempt in range(1, max_attempts + 1):
            status = RunStatusEnum.running if attempt == 1 else RunStatusEnum.retrying
            if attempt > 1:
                backoff_s = self._apply_backoff(attempt)
                if backoff_s > 0:
                    logger.info("Agent %s backoff %.1fs before attempt %d", self.definition.id, backoff_s, attempt)
                    await asyncio.sleep(backoff_s)

            record.status = status
            record.attempts = attempt
            await self.store.update(run_id, status=status, attempts=attempt)

            try:
                result = await asyncio.wait_for(
                    self._execute(request, record),
                    timeout=float(self.definition.timeout_s),
                )
            except asyncio.TimeoutError:
                msg = f"Agent '{self.definition.id}' timed out on attempt {attempt} after {self.definition.timeout_s}s"
                logger.warning(msg)
                record.error = msg
                if attempt < max_attempts:
                    continue
                record.status = RunStatusEnum.failed
                record.finished_at = datetime.datetime.now(datetime.timezone.utc)
                await self.store.update(run_id, status=RunStatusEnum.failed, error=msg, finished_at=record.finished_at)
                return await self._handle_on_fail(record)
            except Exception as exc:
                msg = f"Agent '{self.definition.id}' raised on attempt {attempt}: {exc}"
                logger.exception(msg)
                record.error = msg
                if attempt < max_attempts:
                    continue
                record.status = RunStatusEnum.failed
                record.finished_at = datetime.datetime.now(datetime.timezone.utc)
                await self.store.update(run_id, status=RunStatusEnum.failed, error=msg, finished_at=record.finished_at)
                return await self._handle_on_fail(record)

            if result.error:
                record.error = result.error
                if attempt < max_attempts:
                    continue
                record.status = RunStatusEnum.failed
                record.finished_at = datetime.datetime.now(datetime.timezone.utc)
                await self.store.update(run_id, status=RunStatusEnum.failed, error=result.error, finished_at=record.finished_at)
                return await self._handle_on_fail(record)

            # Acceptance
            all_accepted = all(self._check_acceptance(result, request) for _ in self.definition.acceptance) if self.definition.acceptance else True
            record.acceptance_passed = all_accepted
            break

        finished_at = datetime.datetime.now(datetime.timezone.utc)
        record.finished_at = finished_at
        record.duration_s = (finished_at - now).total_seconds()

        if result is not None:
            record.outputs = result.outputs
            record.cost = result.cost
            record.gpu_seconds = result.gpu_seconds
            record.tokens = result.tokens

        record.status = RunStatusEnum.done

        await self.store.update(
            run_id,
            status=RunStatusEnum.done,
            finished_at=finished_at,
            duration_s=record.duration_s,
            cost=record.cost,
            gpu_seconds=record.gpu_seconds,
            tokens=record.tokens,
            acceptance_passed=record.acceptance_passed,
            outputs=record.outputs,
            error=record.error,
        )
        return record

    async def _execute(self, request: RunRequest, record: RunRecord) -> ExecutorResult:
        return await self.executor.execute(request, self.definition)

    def _check_precondition(self, condition: str, context: dict) -> bool:
        logger.debug("Agent %s precondition '%s' (stub -> True)", self.definition.id, condition)
        return True

    def _check_acceptance(self, result: ExecutorResult, request: RunRequest) -> bool:
        logger.debug("Agent %s acceptance check (stub -> True)", self.definition.id)
        return True

    async def _handle_on_fail(self, record: RunRecord) -> RunRecord:
        on_fail = self.definition.on_fail

        if on_fail == OnFailEnum.escalate:
            raise HTTPException(status_code=500, detail=record.error)

        if on_fail == OnFailEnum.skip:
            record.status = RunStatusEnum.done
            if record.error:
                record.logs.append(f"Skipped after error: {record.error}")
            record.finished_at = record.finished_at or datetime.datetime.now(datetime.timezone.utc)
            await self.store.update(record.run_id, status=RunStatusEnum.done, logs=record.logs)
            return record

        if on_fail == OnFailEnum.halt:
            raise RuntimeError(f"Agent '{self.definition.id}' halted: {record.error}")

        # retry / default: all attempts exhausted, return failed record
        return record

    def _apply_backoff(self, attempt: int) -> float:
        backoff = self.definition.retry.backoff
        if backoff == BackoffEnum.linear:
            return attempt * 2.0
        if backoff == BackoffEnum.exponential:
            return float(2 ** attempt)
        return 0.0
