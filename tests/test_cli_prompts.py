# tests/test_cli_prompts.py
from __future__ import annotations

import argparse
import json
import sys

from animatory import cli
from animatory import entity_registry as er
from animatory import visual_inference as vi


def _episode(tmp_path):
    ep = tmp_path / "C001"
    ep.mkdir()
    reg = er.EntityRegistry(
        episode_id="C001",
        characters=[{"canonical": "Từ An", "aliases": [], "appears_in": ["C001_S01"],
                     "description": {"summary": "a censor"}, "voice": er.empty_voice(),
                     "generated": True}],
        locations=[{"canonical": "Phòng công chúa", "aliases": [], "appears_in": ["C001_S01"],
                    "description": {"summary": "a silk chamber"}, "generated": True}],
    )
    er.save(reg, ep, now="2026-06-18T00:00:00Z")
    (ep / "manifest.json").write_text(json.dumps({"chunks": []}), encoding="utf-8")
    return ep


def test_cmd_prompts_infer_writes_files_and_visual_block(tmp_path, monkeypatch, capsys):
    ep = _episode(tmp_path)

    async def fake(prompt, *, label, **kw):
        if label.startswith("visual/loc/"):
            return {"setting": {"value": "ornate hall", "source": "inferred"}}
        return {"hair": {"value": "topknot", "source": "inferred"},
                "attire": {"value": "silk daopao", "source": "inferred"}}

    monkeypatch.setattr(vi, "_default_call_fn", lambda: fake)

    args = argparse.Namespace(episode_dir=str(ep), infer=True, force=False,
                              qwen_endpoint="http://localhost:1090")
    cli.cmd_prompts(args)

    cdoc = json.loads((ep / "character_prompts.json").read_text(encoding="utf-8"))
    assert (ep / "location_prompts.json").exists()
    assert cdoc["characters"][0]["name"] == "Từ An"
    assert "topknot" in cdoc["characters"][0]["positive"]

    # entities.json gained a visual block from the inference pass
    reloaded = er.load("C001", ep)
    assert reloaded.characters[0]["visual"]["hair"]["value"] == "topknot"

    out = capsys.readouterr().out
    assert "character_prompts.json" in out
    assert "location_prompts.json" in out


def test_cmd_prompts_compile_only_no_infer(tmp_path):
    ep = tmp_path / "C001"
    ep.mkdir()
    reg = er.EntityRegistry(
        episode_id="C001",
        characters=[{"canonical": "Từ An", "aliases": [],
                     "visual": {"hair": {"value": "topknot", "source": "inferred"}},
                     "generated": True}],
    )
    er.save(reg, ep, now="2026-06-18T00:00:00Z")

    args = argparse.Namespace(episode_dir=str(ep), infer=False, force=False,
                              qwen_endpoint="http://localhost:1090")
    cli.cmd_prompts(args)

    cdoc = json.loads((ep / "character_prompts.json").read_text(encoding="utf-8"))
    assert "topknot" in cdoc["characters"][0]["positive"]


def test_main_routes_prompts_subcommand(tmp_path, monkeypatch):
    ep = tmp_path / "C001"
    ep.mkdir()
    reg = er.EntityRegistry(episode_id="C001",
                            characters=[{"canonical": "X", "aliases": [], "generated": True}])
    er.save(reg, ep, now="2026-06-18T00:00:00Z")

    monkeypatch.setattr(sys, "argv", ["animatory.cli", "prompts", str(ep)])
    cli.main()  # default flags: --infer off, --force off
    assert (ep / "character_prompts.json").exists()
    assert (ep / "location_prompts.json").exists()
