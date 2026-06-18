# animatory/enrichment/prompts.py
"""Central prompt composer — 'enrich the prompt before generation'.

The generators (genimage) own style presets, rig identity (LoRA trigger) and the
engine; this module owns *assembling the textual prompt* and, crucially, injects
the enriched entity description that `entity_enrichment` produces (summary /
appearance / attire / palette) — data the raw prompt builders never read.

Pure and dependency-light: callers pass plain strings/lists looked up from the
entity registry, so this imports no genimage/zimage types. genimage calls in;
enrichment never calls out.
"""
from __future__ import annotations

from collections.abc import Iterable


def compose_image_prompt(
    *,
    subject_desc: str = "",
    action: str = "",
    setting_desc: str = "",
    items: Iterable[str] | None = None,
    style_tokens: str = "",
    negative_base: str = "",
) -> tuple[str, str]:
    """Weave the enriched description + action + setting + items + style into a
    ``(positive, negative)`` prompt pair.

    Order is deterministic: subject → action → ``background: <setting>`` →
    ``with <item>`` (each) → style tokens. Empty fields are omitted. The negative
    is the caller's ``negative_base`` (generators append their style-negative).
    """
    parts: list[str] = []
    if subject_desc and subject_desc.strip():
        parts.append(subject_desc.strip())
    if action and action.strip():
        parts.append(action.strip())
    if setting_desc and setting_desc.strip():
        parts.append(f"background: {setting_desc.strip()}")
    for item in items or []:
        if item and item.strip():
            parts.append(f"with {item.strip()}")
    if style_tokens and style_tokens.strip():
        parts.append(style_tokens.strip())

    positive = ", ".join(parts)
    negative = negative_base.strip() if negative_base else ""
    return positive, negative
