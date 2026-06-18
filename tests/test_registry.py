"""Tests for animatory.registry — loads real agent-framework.yaml."""
from pathlib import Path

import pytest

from animatory.runtime.models import AgentDef, StackEnum
from animatory.runtime.registry import load_registry, AgentRegistry

YAML_PATH = Path(__file__).parent.parent / "agent-framework.yaml"


@pytest.fixture(scope="module")
def registry() -> AgentRegistry:
    return load_registry(str(YAML_PATH))


def test_load_registry_returns_registry(registry):
    assert isinstance(registry, AgentRegistry)


def test_all_agents_are_agent_defs(registry):
    agents = registry.all()
    assert len(agents) > 0
    for agent in agents:
        assert isinstance(agent, AgentDef), f"{agent!r} is not an AgentDef"


def test_exec_animation_has_three_workflow_files(registry):
    agent = registry.get("exec.animation")
    assert isinstance(agent, AgentDef)
    assert len(agent.workflow_files) == 3, f"Expected 3, got {agent.workflow_files}"


def test_orch_showrunner_stack_is_orchestration(registry):
    agent = registry.get("orch.showrunner")
    assert agent.stack == StackEnum.orchestration


def test_get_raises_key_error_for_unknown_id(registry):
    with pytest.raises(KeyError):
        registry.get("nonexistent.agent.xyz")
