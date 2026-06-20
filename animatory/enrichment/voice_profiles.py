# animatory/voice_profiles.py
from __future__ import annotations

from collections import Counter


def aggregate(scenes: list[dict]) -> list[dict]:
    """Derive per-character emotion stats across *scenes* (already-loaded shot
    lists). Pure — no I/O. Profiles are sorted by line_count descending."""
    counts: dict[str, int] = {}
    emotions: dict[str, Counter] = {}
    intensities: dict[str, Counter] = {}
    order: list[str] = []

    for s in scenes:
        for d in s.get("dialogue", []) or []:
            if not isinstance(d, dict):
                continue
            name = d.get("character")
            if not name:
                continue
            if name not in counts:
                counts[name] = 0
                emotions[name] = Counter()
                intensities[name] = Counter()
                order.append(name)
            counts[name] += 1
            if d.get("emotion"):
                emotions[name][d["emotion"]] += 1
            if d.get("intensity"):
                intensities[name][d["intensity"]] += 1

    profiles = [
        {
            "character": name,
            "line_count": counts[name],
            "emotions": dict(emotions[name]),
            "dominant_emotion": emotions[name].most_common(1)[0][0] if emotions[name] else None,
            "dominant_intensity": intensities[name].most_common(1)[0][0] if intensities[name] else None,
        }
        for name in order
    ]
    profiles.sort(key=lambda p: p["line_count"], reverse=True)
    return profiles
