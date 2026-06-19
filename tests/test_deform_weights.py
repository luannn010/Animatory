"""Auto-weight tests — animatory/deform/weights.py."""
from __future__ import annotations

import pytest

from animatory.deform.models import BindBone
from animatory.deform.weights import distance_falloff

# Two vertical bones stacked along x=100: top spans y 80..150, bottom 150..220.
TOP = BindBone(id="top", x=100, y=80, tip_x=100, tip_y=150)
BOTTOM = BindBone(id="bottom", x=100, y=150, tip_x=100, tip_y=220)


def test_weights_normalized_and_capped():
    verts = [100.0, 90.0, 100.0, 210.0, 140.0, 150.0]
    out = distance_falloff(verts, [TOP, BOTTOM])
    assert len(out) == 3
    for vw in out:
        assert len(vw.bones) == len(vw.values)
        assert len(vw.bones) <= 4
        assert vw.bones  # at least one influence
        assert abs(sum(vw.values) - 1.0) < 1e-6


def test_nearer_bone_gets_more_weight():
    # vertex (100,90) lies on the TOP segment → TOP must dominate
    out = distance_falloff([100.0, 90.0], [TOP, BOTTOM])
    vw = out[0]
    weight = dict(zip(vw.bones, vw.values))
    assert weight["top"] > weight["bottom"]


def test_single_bone_is_full_weight():
    out = distance_falloff([10.0, 10.0, 50.0, 50.0], [TOP])
    for vw in out:
        assert vw.bones == ["top"]
        assert vw.values == [1.0]


def test_caps_at_four_bones():
    bones = [BindBone(id=f"b{i}", x=float(i * 10), y=0, tip_x=float(i * 10), tip_y=20) for i in range(6)]
    out = distance_falloff([25.0, 10.0], bones)
    assert len(out[0].bones) == 4
    assert abs(sum(out[0].values) - 1.0) < 1e-6


def test_no_bones_raises():
    with pytest.raises(ValueError):
        distance_falloff([0.0, 0.0], [])
