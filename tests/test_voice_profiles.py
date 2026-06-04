# tests/test_voice_profiles.py
from animatory.voice_profiles import aggregate


def test_aggregate_counts_emotions_per_character():
    scenes = [
        {"dialogue": [
            {"character": "A", "line": "x", "emotion": "angry", "intensity": "high"},
            {"character": "A", "line": "y", "emotion": "angry", "intensity": "low"},
            {"character": "B", "line": "z", "emotion": "happy"},
        ]},
        {"dialogue": [
            {"character": "A", "line": "w", "emotion": "neutral", "intensity": "high"},
        ]},
    ]
    profiles = aggregate(scenes)
    a = next(p for p in profiles if p["character"] == "A")
    assert a["line_count"] == 3
    assert a["emotions"] == {"angry": 2, "neutral": 1}
    assert a["dominant_emotion"] == "angry"
    assert a["dominant_intensity"] == "high"
    assert profiles[0]["character"] == "A"  # sorted by line_count desc


def test_aggregate_handles_missing_emotion_and_empty():
    assert aggregate([]) == []
    profiles = aggregate([{"dialogue": [{"character": "A", "line": "x"}]}])
    assert profiles[0]["emotions"] == {}
    assert profiles[0]["dominant_emotion"] is None
    assert profiles[0]["dominant_intensity"] is None
