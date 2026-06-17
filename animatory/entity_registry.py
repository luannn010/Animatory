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
        items: list[dict] | None = None,
        updated_at: str | None = None,
    ) -> None:
        self.episode_id = episode_id
        self.characters: list[dict] = characters or []
        self.locations: list[dict] = locations or []
        # Recurring "special items" (props). Same {canonical, aliases[]} shape as the
        # other rosters, optionally carrying {description, appears_in[]} from the LLM
        # extractor. Items are not a structured scene field, so they are learned
        # separately via ``learn_items`` rather than ``learn``.
        self.items: list[dict] = items or []
        self.updated_at = updated_at

    def to_dict(self) -> dict:
        return {
            "episode_id": self.episode_id,
            "updated_at": self.updated_at,
            "characters": self.characters,
            "locations": self.locations,
            "items": self.items,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EntityRegistry":
        return cls(
            episode_id=d.get("episode_id", ""),
            characters=d.get("characters", []),
            locations=d.get("locations", []),
            items=d.get("items", []),
            updated_at=d.get("updated_at"),
        )

    def known_names(self) -> dict:
        return {
            "characters": [e["canonical"] for e in self.characters],
            "locations": [e["canonical"] for e in self.locations],
            "items": [e["canonical"] for e in self.items],
        }

    def _alias_map(self, entries: list[dict]) -> dict:
        m: dict[str, str] = {}
        for e in entries:
            canonical = e["canonical"]
            m[_key(canonical)] = canonical
            for a in e.get("aliases", []):
                m[_key(a)] = canonical
        return m

    def normalize_scene(self, scene: dict) -> dict:
        """Return a copy of *scene* with structured proper-noun fields mapped to
        canonical spellings. Only ``location``, ``characters[]`` and
        ``dialogue[].character`` are touched — free prose is never altered."""
        char_map = self._alias_map(self.characters)
        loc_map = self._alias_map(self.locations)

        def canon(name: str, m: dict) -> str:
            return m.get(_key(name), name) if isinstance(name, str) else name

        scene = dict(scene)
        if isinstance(scene.get("location"), str):
            scene["location"] = canon(scene["location"], loc_map)
        if isinstance(scene.get("characters"), list):
            scene["characters"] = [canon(c, char_map) for c in scene["characters"]]
        if isinstance(scene.get("dialogue"), list):
            scene["dialogue"] = [
                {**d, "character": canon(d["character"], char_map)}
                if isinstance(d, dict) and "character" in d
                else d
                for d in scene["dialogue"]
            ]
        return scene

    def learn(self, scenes: list[dict]) -> "EntityRegistry":
        """Add genuinely-new character/location names to the registry. A name is
        new only if its key matches no existing canonical or alias. Idempotent."""
        char_keys = {_key(e["canonical"]) for e in self.characters}
        char_keys |= {_key(a) for e in self.characters for a in e.get("aliases", [])}
        loc_keys = {_key(e["canonical"]) for e in self.locations}
        loc_keys |= {_key(a) for e in self.locations for a in e.get("aliases", [])}

        def add(name: str, entries: list[dict], keys: set[str]) -> None:
            if not isinstance(name, str) or not name.strip():
                return
            k = _key(name)
            if k in keys:
                return
            entries.append({"canonical": name.strip(), "aliases": []})
            keys.add(k)

        for s in scenes:
            add(s.get("location", ""), self.locations, loc_keys)
            for c in s.get("characters", []) or []:
                add(c, self.characters, char_keys)
            for d in s.get("dialogue", []) or []:
                if isinstance(d, dict):
                    add(d.get("character", ""), self.characters, char_keys)
        return self

    def learn_items(self, items: list[dict]) -> "EntityRegistry":
        """Merge LLM-extracted recurring items into the registry. Each item is a dict with
        at least ``canonical`` (or ``name``), optionally ``aliases``/``description``/
        ``appears_in``. A name already known as a character or location is skipped, so a
        prop is never double-filed as a person/place. Idempotent on the canonical key."""
        item_keys = {_key(e["canonical"]) for e in self.items}
        item_keys |= {_key(a) for e in self.items for a in e.get("aliases", [])}
        reserved = {_key(e["canonical"]) for e in self.characters}
        reserved |= {_key(a) for e in self.characters for a in e.get("aliases", [])}
        reserved |= {_key(e["canonical"]) for e in self.locations}
        reserved |= {_key(a) for e in self.locations for a in e.get("aliases", [])}

        for it in items or []:
            name = (it.get("canonical") or it.get("name") or "").strip()
            if not name:
                continue
            k = _key(name)
            if k in reserved or k in item_keys:
                continue
            entry = {"canonical": name, "aliases": list(it.get("aliases", []))}
            if it.get("description"):
                entry["description"] = it["description"]
            if it.get("appears_in"):
                entry["appears_in"] = list(it["appears_in"])
            self.items.append(entry)
            item_keys.add(k)
        return self


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
