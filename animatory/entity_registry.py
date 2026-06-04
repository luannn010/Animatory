# animatory/entity_registry.py
from __future__ import annotations

import json
import unicodedata
from pathlib import Path


def _key(name: str) -> str:
    """Case-insensitive, diacritic-significant match key for a proper noun.

    NFC-normalize, collapse internal whitespace, strip, casefold. Diacritics are
    intentionally preserved so distinct Vietnamese names are not merged.
    """
    nfc = unicodedata.normalize("NFC", name)
    return " ".join(nfc.split()).casefold()


class EntityRegistry:
    def __init__(
        self,
        episode_id: str,
        characters: list[dict] | None = None,
        locations: list[dict] | None = None,
        updated_at: str | None = None,
    ) -> None:
        self.episode_id = episode_id
        self.characters: list[dict] = characters or []
        self.locations: list[dict] = locations or []
        self.updated_at = updated_at

    def to_dict(self) -> dict:
        return {
            "episode_id": self.episode_id,
            "updated_at": self.updated_at,
            "characters": self.characters,
            "locations": self.locations,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EntityRegistry":
        return cls(
            episode_id=d.get("episode_id", ""),
            characters=d.get("characters", []),
            locations=d.get("locations", []),
            updated_at=d.get("updated_at"),
        )

    def known_names(self) -> dict:
        return {
            "characters": [e["canonical"] for e in self.characters],
            "locations": [e["canonical"] for e in self.locations],
        }


def _path(episode_dir: Path) -> Path:
    return episode_dir / "entities.json"


def load(episode_id: str, episode_dir: Path) -> EntityRegistry:
    p = _path(episode_dir)
    if not p.exists():
        return EntityRegistry(episode_id=episode_id)
    return EntityRegistry.from_dict(json.loads(p.read_text(encoding="utf-8")))


def save(registry: EntityRegistry, episode_dir: Path, *, now: str) -> Path:
    registry.updated_at = now
    p = _path(episode_dir)
    p.write_text(
        json.dumps(registry.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return p
