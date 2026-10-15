"""Which paths of a data source may be read, decided before anything is asked.

The device checks again on its own disk -- it is the only side that can see a
symlink -- but the server refuses what the source's owner did not share
without bothering the device, and records the refusal.

Paths are relative to the source root, ``/``-separated and NFC-normalised.
macOS hands out NFD names, so a Korean folder name would otherwise never match
the same name typed on a phone.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass


class PathDenied(Exception):
    """A requested path that no source may serve, whatever it shares."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def normalize_path(raw: str | None) -> str:
    """Canonical relative form of [raw]; ``""`` is the source root.

    Raises [PathDenied] for anything that tries to leave the source: absolute
    paths, ``..``, a home-directory ``~``, or a NUL byte. Hidden entries
    (``.obsidian``, ``.git``, ``.trash``) are application state, not notes.
    """
    if raw is None:
        return ""
    text = unicodedata.normalize("NFC", raw.strip()).replace("\\", "/")
    if "\x00" in text:
        raise PathDenied("invalid_path")
    if text.startswith("/") or text.startswith("~") or (len(text) > 1 and text[1] == ":"):
        raise PathDenied("absolute_path")
    parts: list[str] = []
    for part in text.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            raise PathDenied("outside_source")
        if part.startswith("."):
            raise PathDenied("hidden_path")
        parts.append(part)
    return "/".join(parts)


def _inside(path: str, folder: str) -> bool:
    return folder == "" or path == folder or path.startswith(folder + "/")


@dataclass(frozen=True)
class SharePolicy:
    """The folders a source's owner shared, and the ones they held back."""

    include: tuple[str, ...]
    exclude: tuple[str, ...]

    @classmethod
    def from_lists(cls, include: list[str], exclude: list[str]) -> "SharePolicy":
        return cls(
            include=tuple(normalize_path(folder) for folder in include),
            exclude=tuple(normalize_path(folder) for folder in exclude if folder.strip()),
        )

    def _excluded(self, path: str) -> bool:
        return any(folder and _inside(path, folder) for folder in self.exclude)

    def can_read(self, path: str) -> bool:
        """[path] is inside a shared folder and outside every held-back one."""
        if self._excluded(path):
            return False
        if not self.include:
            return True
        return any(_inside(path, folder) for folder in self.include)

    def leads_to_shared(self, path: str) -> bool:
        """[path] is a folder on the way down to a shared one.

        Lets a phone browse from the root to ``01_Projects`` when only that
        folder is shared, without listing anything beside it.
        """
        if self._excluded(path):
            return False
        return any(folder != path and _inside(folder, path) for folder in self.include)

    def can_list(self, folder: str) -> bool:
        return self.can_read(folder) or self.leads_to_shared(folder)

    def shows_entry(self, path: str, *, is_dir: bool) -> bool:
        """Whether an entry may appear in a listing or a search result."""
        if any(part.startswith(".") for part in path.split("/")):
            return False
        if self.can_read(path):
            return True
        return is_dir and self.leads_to_shared(path)
