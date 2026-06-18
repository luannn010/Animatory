# animatory/genvoice/schemas.py
from __future__ import annotations

from pydantic import BaseModel


class VoiceSynthRequest(BaseModel):
    """One line of speech to synthesize."""
    text: str
    character: str | None = None   # resolve the voice from the entity bible if given
    voice: str | None = None       # explicit voice id; overrides the character profile
    emotion: str | None = None     # optional delivery hint (from the dialogue beat)


class VoiceSynthResponse(BaseModel):
    status: str                    # "queued" | "done" | "unimplemented"
    audio_url: str | None = None
    error: str | None = None
