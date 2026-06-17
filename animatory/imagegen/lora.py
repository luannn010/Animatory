"""LoRA name->path resolution (BACKEND_SPEC.md §6).

A request carries ``LoraConfig`` entries by *name*; the registry maps each name to a
``.safetensors`` path under ``LORA_DIR`` and validates existence **before** inference. An unknown
name fails the job loudly (never silently skipped). The directory is scanned on each call so a
freshly trained/dropped LoRA is picked up without a restart (future-proofing, spec §6).
"""

from __future__ import annotations

import os
from pathlib import Path

_EXT = ".safetensors"


class LoraNotFound(Exception):
    """Raised when a requested LoRA name has no matching file under ``LORA_DIR``."""


class LoraRegistry:
    def __init__(self, lora_dir: str | os.PathLike | None = None) -> None:
        self.lora_dir = Path(lora_dir or os.environ.get("LORA_DIR", "loras"))

    def resolve(self, name: str) -> str:
        """Return the absolute path for ``name`` (with or without extension), or raise.

        The registry name is the filename without extension; callers may pass either form.
        """
        stem = name[: -len(_EXT)] if name.endswith(_EXT) else name
        path = self.lora_dir / f"{stem}{_EXT}"
        if not path.is_file():
            available = self.list_available()
            hint = f" Available: {', '.join(available)}." if available else ""
            raise LoraNotFound(
                f"LoRA {name!r} not found in {self.lora_dir}.{hint}"
            )
        return str(path)

    def list_available(self) -> list[str]:
        """Return sorted registry names (filenames without ``.safetensors``)."""
        if not self.lora_dir.is_dir():
            return []
        return sorted(p.stem for p in self.lora_dir.glob(f"*{_EXT}") if p.is_file())
