# animatory/genvoice/service.py
"""GenVoice service interface — TTS from text + a character voice profile.

SCAFFOLD: the contract and seam are defined; no TTS engine is wired yet. A real
implementation receives the line (`req.text`, optional `req.emotion`) and the
character's voice profile and returns an audio artifact.

The `voice_profile` passed in is exactly the shape produced upstream:
``animatory.enrichment.voice_profiles.aggregate`` entries merged with the entity
registry's ``voice`` block (register / tone / pace) — so the generator never has
to reach back into parsing/enrichment itself.
"""
from __future__ import annotations

from animatory.genvoice.schemas import VoiceSynthRequest, VoiceSynthResponse


async def synthesize(
    req: VoiceSynthRequest, *, voice_profile: dict | None = None
) -> VoiceSynthResponse:
    """Synthesize one line. Not implemented — wire a TTS backend here."""
    raise NotImplementedError(
        "genvoice TTS backend not yet implemented. Inputs ready: req.text, "
        "req.character/req.voice/req.emotion, and `voice_profile` (from "
        "enrichment.voice_profiles.aggregate + the registry 'voice' block)."
    )
