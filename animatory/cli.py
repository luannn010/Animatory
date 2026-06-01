from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import pathlib
import sys

from animatory.registry import load_registry
from animatory.run_store import InMemoryRunStore
from animatory.base_agent import BaseAgent
from animatory.models import RunRequest
from animatory.executors.fake import FakeExecutor
from animatory.executors.comfyui import ComfyUIExecutor
from animatory.executors.llamacpp import LlamaCppExecutor

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


async def cmd_run(args: argparse.Namespace) -> None:
    registry = load_registry()

    try:
        agent_def = registry.get(args.agent_id)
    except KeyError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    context: dict = {}
    if args.context:
        ctx_path = pathlib.Path(args.context)
        if not ctx_path.exists():
            print(f"Error: context file '{args.context}' does not exist.", file=sys.stderr)
            sys.exit(1)
        with open(ctx_path, "r", encoding="utf-8") as f:
            context = json.load(f)

    if args.fake or os.environ.get("ANIMATORY_FAKE_EXECUTORS") == "1":
        executor = FakeExecutor()
    else:
        stack = agent_def.stack.value
        if stack == "comfyui":
            executor = ComfyUIExecutor()
        elif stack in ("text", "orchestration"):
            executor = LlamaCppExecutor()
        else:
            executor = FakeExecutor()

    store = InMemoryRunStore()
    await store.init()

    request = RunRequest(context=context, system_prompt=args.system_prompt or "")
    agent = BaseAgent(agent_def, executor, store)
    record = await agent.run(request)

    print(f"run_id : {record.run_id}")
    print(f"status : {record.status.value}")
    print(f"attempts: {record.attempts}")
    if record.duration_s is not None:
        print(f"duration: {record.duration_s:.2f}s")
    if record.outputs:
        print("outputs:")
        for out in record.outputs:
            print(f"  {out.name} ({out.type}) -> {out.path}")
    else:
        print("outputs: (none)")
    if record.error:
        print(f"error  : {record.error}")


def cmd_list(_args: argparse.Namespace) -> None:
    registry = load_registry()
    agents = registry.all()

    if not agents:
        print("No agents found in registry.")
        return

    col_id = max(len("id"), max(len(a.id) for a in agents))
    col_stack = max(len("stack"), max(len(a.stack.value) for a in agents))

    header = f"{'id':<{col_id}}  {'stack':<{col_stack}}  role"
    print(header)
    print("-" * (len(header) + 20))
    for a in agents:
        print(f"{a.id:<{col_id}}  {a.stack.value:<{col_stack}}  {a.role}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="animatory.cli", description="Animatory CLI")
    sub = parser.add_subparsers(dest="command")

    run_p = sub.add_parser("run", help="Run an agent")
    run_p.add_argument("agent_id")
    run_p.add_argument("--context", metavar="<json_file>", default=None)
    run_p.add_argument("--system-prompt", metavar="<text>", default=None)
    run_p.add_argument("--fake", action="store_true", help="Use FakeExecutor")

    sub.add_parser("list", help="List all agents")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(cmd_run(args))
    elif args.command == "list":
        cmd_list(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
