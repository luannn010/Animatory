from abc import ABC, abstractmethod

from animatory.runtime.models import RunRequest, AgentDef, ExecutorResult


class AbstractExecutor(ABC):
    @abstractmethod
    async def execute(self, request: RunRequest, definition: AgentDef) -> ExecutorResult: ...

    @abstractmethod
    async def health_check(self) -> bool: ...

    @property
    @abstractmethod
    def name(self) -> str: ...
