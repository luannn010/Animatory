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
from animatory.chunker import chunk_file

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


def cmd_chunk(args: argparse.Namespace) -> None:
    source = pathlib.Path(args.source)
    if not source.exists():
        print(f"Error: file not found: {source}", file=sys.stderr)
        sys.exit(1)

    output_dir = pathlib.Path(args.output_dir) / source.stem
    manifest_path = chunk_file(
        source,
        output_dir,
        target_words=args.target_words,
        overlap_words=args.overlap_words,
        min_chunk_words=args.min_chunk_words,
    )
    print(f"Manifest: {manifest_path}")

    if args.self_test:
        import json as _json
        text = source.read_text(encoding="utf-8")
        manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
        errors = []
        for c in manifest["chunks"]:
            chunk_path = manifest_path.parent / c["file"]
            got = chunk_path.read_text(encoding="utf-8")
            expected = text[c["char_start"]:c["char_end"]]
            if got != expected:
                errors.append(f"{c['chunk_id']}: offset mismatch")
        if errors:
            print("SELF-TEST FAILED:", file=sys.stderr)
            for e in errors:
                print(f"  {e}", file=sys.stderr)
            sys.exit(1)
        else:
            print("Self-test PASSED: all offsets valid.")

    if args.parse:
        import asyncio as _asyncio
        from animatory.scene_parser import parse_episode
        _asyncio.run(parse_episode(
            source.stem,
            manifest_path.parent,
            qwen_endpoint=args.qwen_endpoint,
        ))


def cmd_prompts(args: argparse.Namespace) -> None:
    from datetime import datetime, timezone
    from animatory import entity_registry, prompt_compiler, visual_inference
    from animatory.scene_parser import _qwen_env

    episode_dir = pathlib.Path(args.episode_dir)
    if not episode_dir.exists():
        print(f"Error: episode dir not found: {episode_dir}", file=sys.stderr)
        sys.exit(1)
    episode_id = episode_dir.name

    if args.infer:
        endpoint, model_name, retries, timeout_s, enable_thinking = _qwen_env(args.qwen_endpoint)
        qwen = dict(
            endpoint=endpoint, model_name=model_name, retries=retries,
            timeout_s=timeout_s, enable_thinking=enable_thinking,
        )
        registry = entity_registry.load(episode_id, episode_dir)
        asyncio.run(visual_inference.infer_visuals(
            registry, qwen=qwen, force=args.force, episode_dir=episode_dir,
        ))
        entity_registry.save(
            registry, episode_dir, now=datetime.now(timezone.utc).isoformat(),
        )

    char_path, loc_path = prompt_compiler.compile_episode(episode_id, episode_dir)
    print(f"Character prompts: {char_path}")
    print(f"Location prompts : {loc_path}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="animatory.cli", description="Animatory CLI")
    sub = parser.add_subparsers(dest="command")

    run_p = sub.add_parser("run", help="Run an agent")
    run_p.add_argument("agent_id")
    run_p.add_argument("--context", metavar="<json_file>", default=None)
    run_p.add_argument("--system-prompt", metavar="<text>", default=None)
    run_p.add_argument("--fake", action="store_true", help="Use FakeExecutor")

    sub.add_parser("list", help="List all agents")

    chunk_p = sub.add_parser("chunk", help="Chunk a transcript file")
    chunk_p.add_argument("source", metavar="<txt_file>")
    chunk_p.add_argument("--output-dir", default="processed", metavar="<dir>")
    chunk_p.add_argument("--target-words", type=int, default=4600)
    chunk_p.add_argument("--overlap-words", type=int, default=250)
    chunk_p.add_argument("--min-chunk-words", type=int, default=500)
    chunk_p.add_argument("--self-test", action="store_true")
    chunk_p.add_argument("--parse", action="store_true", help="Also run scene parser after chunking")
    chunk_p.add_argument("--qwen-endpoint", default="http://localhost:1090")

    prompts_p = sub.add_parser("prompts", help="Generate Z-Image prompts for an episode")
    prompts_p.add_argument("episode_dir", metavar="<processed/EPISODE_DIR>")
    prompts_p.add_argument("--infer", action="store_true",
                           help="Run free visual inference before compiling")
    prompts_p.add_argument("--force", action="store_true",
                           help="Overwrite existing visual fields during inference")
    prompts_p.add_argument("--qwen-endpoint", default="http://localhost:1090")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(cmd_run(args))
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "chunk":
        cmd_chunk(args)
    elif args.command == "prompts":
        cmd_prompts(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
