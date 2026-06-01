from __future__ import annotations

import logging
import os
import pathlib

import yaml

from animatory.models import AgentDef, AgentInput, AgentOutput, RetryConfig, LayerEnum

logger = logging.getLogger(__name__)


class AgentRegistry:
    def __init__(self, yaml_path: str = "agent-framework.yaml") -> None:
        self.yaml_path = yaml_path
        self._agents: dict[str, AgentDef] = {}

    def load(self) -> dict[str, AgentDef]:
        path = pathlib.Path(self.yaml_path)
        if not path.is_absolute():
            path = pathlib.Path.cwd() / path

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        agents: dict[str, AgentDef] = {}

        for raw in data.get("orchestration_layer", []):
            agent = self._parse_agent(raw, layer=LayerEnum.orchestration, stack_hint=None)
            agents[agent.id] = agent

        execution_layer = data.get("execution_layer", {})
        for stack_key, agent_list in execution_layer.items():
            if not isinstance(agent_list, list):
                continue
            for raw in agent_list:
                agent = self._parse_agent(raw, layer=LayerEnum.execution, stack_hint=stack_key)
                agents[agent.id] = agent

        self._agents = agents
        logger.info("Loaded %d agents from %s", len(agents), self.yaml_path)
        return agents

    def _parse_agent(self, raw: dict, layer: LayerEnum, stack_hint: str | None) -> AgentDef:
        raw = dict(raw)
        raw["layer"] = layer.value

        if "stack" not in raw or raw["stack"] is None:
            raw["stack"] = stack_hint if stack_hint is not None else layer.value

        if "inputs" in raw and isinstance(raw["inputs"], list):
            raw["inputs"] = [
                AgentInput(**inp) if isinstance(inp, dict) else inp
                for inp in raw["inputs"]
            ]

        if "outputs" in raw and isinstance(raw["outputs"], list):
            raw["outputs"] = [
                AgentOutput(**out) if isinstance(out, dict) else out
                for out in raw["outputs"]
            ]

        if "retry" in raw and isinstance(raw["retry"], dict):
            raw["retry"] = RetryConfig(**raw["retry"])
        elif "retry" not in raw:
            raw["retry"] = RetryConfig()

        if not raw.get("name"):
            raw["name"] = raw.get("role", raw["id"])

        return AgentDef(**raw)

    def get(self, agent_id: str) -> AgentDef:
        if agent_id not in self._agents:
            raise KeyError(
                f"Agent '{agent_id}' not found. Available: {list(self._agents.keys())}"
            )
        return self._agents[agent_id]

    def all(self) -> list[AgentDef]:
        return list(self._agents.values())


def load_registry(yaml_path: str | None = None) -> AgentRegistry:
    if yaml_path is None:
        yaml_path = os.environ.get("ANIMATORY_YAML_PATH", "agent-framework.yaml")
    registry = AgentRegistry(yaml_path=str(yaml_path))
    registry.load()
    return registry
