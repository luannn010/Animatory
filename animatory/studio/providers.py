"""Model-workflow seams — STUBBED.

These functions are where real model work plugs in later. Each currently
returns canned data after a short simulated delay. Replace the *body* of each
function with a real model workflow (LLM script breakdown, TTS voice render,
etc.) — the signatures and return types are the contract the rest of the
studio backend depends on, so callers and routes won't need to change.

    parse_script()   -> scene breakdown        [LLM seam]
    generate_voice() -> dialogue audio preview  [TTS seam]
"""
from __future__ import annotations

import asyncio

from animatory.studio.models import Scene, VoicePreview
from animatory.studio.seed import seed_scenes


async def parse_script(project_id: str, text: str, filenames: list[str]) -> list[Scene]:
    """[LLM SEAM] Break a script/transcript into scene clips.

    TODO(model): replace with a real LLM call — feed ``text`` (and/or the
    uploaded ``filenames``) to a script-breakdown model and map its structured
    output onto ``Scene`` objects. For now returns canned scenes.
    """
    # Simulated model latency only; the caller drives progress for SSE.
    await asyncio.sleep(0.05)
    return seed_scenes(project_id)


async def generate_voice(project_id: str, character: str, voice: str) -> VoicePreview:
    """[TTS SEAM] Render a short dialogue preview for a character's voice.

    TODO(model): replace with a real TTS call — synthesize a sample line in the
    chosen ``voice`` and return a playable artifact URL. For now returns a stub.
    """
    await asyncio.sleep(0.05)
    return VoicePreview(
        character=character,
        voice=voice,
        audio_url=f"http://fake/voice/{project_id}/{character.lower()}.wav",
        duration_s=2.4,
    )
