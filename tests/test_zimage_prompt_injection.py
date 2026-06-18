# tests/test_zimage_prompt_injection.py
"""compose_shot_prompt now delegates to enrichment.prompts and injects the
enriched entity description (appearance/attire/...) carried on the rig — so
generated-image prompts actually describe the subject, not just name it.
"""
from __future__ import annotations

from animatory.genimage.zimage.rig import Rig
from animatory.genimage.zimage.shots import Shot, index_rigs, compose_shot_prompt


def _shot() -> Shot:
    return Shot(id="s1", sceneId="C001_S01", action="draws a blade",
                characters=["Hero"], location="Courtyard", items=[], seed=0)


def test_rig_description_is_injected_into_prompt():
    hero = Rig(name="Hero", kind="character", description="a tall censor in dark robes")
    court = Rig(name="Courtyard", kind="location", description="moonlit stone courtyard")
    p = compose_shot_prompt(_shot(), index_rigs([hero, court]))
    assert p.startswith("Hero, a tall censor in dark robes")   # description folded into subject
    assert "draws a blade" in p
    assert "moonlit stone courtyard" in p                       # location description injected


def test_parity_when_no_description():
    hero = Rig(name="Hero", kind="character")
    court = Rig(name="Courtyard", kind="location")
    p = compose_shot_prompt(_shot(), index_rigs([hero, court]))
    # identical shape to before: identity, action, background: loc, ..., style
    assert p.startswith("Hero, draws a blade, background: Courtyard")
    assert "a tall censor" not in p


def test_description_survives_rig_json_roundtrip():
    r = Rig(name="Hero", kind="character", description="dark robes, sharp eyes")
    assert Rig.from_dict(r.to_dict()).description == "dark robes, sharp eyes"
