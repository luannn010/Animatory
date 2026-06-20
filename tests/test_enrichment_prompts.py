# tests/test_enrichment_prompts.py
"""Layer that 'enriches the prompt before generation': compose_image_prompt
weaves the enriched entity description (which the generators never read today)
into the final positive prompt, alongside action / setting / items / style.
"""
from __future__ import annotations

from animatory.enrichment.prompts import compose_image_prompt


def test_injects_subject_description_into_positive():
    pos, neg = compose_image_prompt(
        subject_desc="a tall censor in dark robes, sharp eyes",
        action="standing at the gate",
        setting_desc="a moonlit courtyard",
        items=["a jade seal"],
        style_tokens="flat color 2D toon, clean lineart",
        negative_base="deformed hands, extra limbs",
    )
    # the enriched description (from entity_enrichment) is now IN the prompt
    assert "a tall censor in dark robes, sharp eyes" in pos
    assert "standing at the gate" in pos
    assert "background: a moonlit courtyard" in pos
    assert "with a jade seal" in pos
    assert "flat color 2D toon" in pos
    assert "deformed hands, extra limbs" in neg


def test_empty_fields_are_omitted():
    pos, neg = compose_image_prompt(
        subject_desc="hero", action="", setting_desc="", items=[],
        style_tokens="", negative_base="",
    )
    assert pos == "hero"
    assert neg == ""


def test_order_is_subject_then_action_then_setting_then_items_then_style():
    pos, _ = compose_image_prompt(
        subject_desc="S", action="A", setting_desc="L", items=["I1", "I2"],
        style_tokens="STY", negative_base="",
    )
    assert pos == "S, A, background: L, with I1, with I2, STY"
