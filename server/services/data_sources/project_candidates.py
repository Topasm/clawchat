"""Project folders a vault already has, offered as projects to create.

The folders come from two places: the server's own vault, and the light index
of every vault a device shares (paths only, never contents). A folder is a
candidate when it sits directly under the project root (``01_Projects`` or the
configured root) or holds a ``TODO.md``, and no project has its name yet.
"""

import asyncio
import logging
import posixpath
import re

from config import settings
from models.data_source import DataSource, DataSourceEntry
from models.project import Project
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.data_sources.service import policy_for
from services.vault.obsidian_context_service import list_project_folders

logger = logging.getLogger(__name__)

_LIMIT = 50
# Without a configured root, a top-level folder named like "01_Projects".
_PROJECTS_FOLDER = re.compile(r"^(?:\d+[\s._-]*)?projects?$", re.IGNORECASE)
# The vault's own inbox holds a TODO.md too, but it is not a project.
_INBOX_FOLDER = re.compile(r"^(?:\d+[\s._-]*)?inbox$", re.IGNORECASE)


class ProjectFolderCandidate(BaseModel):
    name: str
    folder: str
    source_name: str
    has_todo: bool


def _is_project_root(folder: str, configured: str) -> bool:
    if configured:
        return folder == configured.strip("/")
    return "/" not in folder and bool(_PROJECTS_FOLDER.match(folder))


def _from_index(paths: list[str], configured: str) -> dict[str, bool]:
    """``{folder: has_todo}`` for the project folders a list of file paths shows."""
    found: dict[str, bool] = {}
    for path in paths:
        parent = posixpath.dirname(path)
        if posixpath.basename(path).lower() == "todo.md" and parent:
            found[parent] = True
        parts = path.split("/")
        for depth in range(1, len(parts) - 1):
            root = "/".join(parts[:depth])
            if _is_project_root(root, configured):
                found.setdefault("/".join(parts[: depth + 1]), False)
                break
    return found


async def _server_vault() -> list[ProjectFolderCandidate]:
    if not settings.obsidian_vault_path:
        return []
    try:
        folders = await asyncio.to_thread(
            list_project_folders,
            settings.obsidian_vault_path,
            "",
            settings.obsidian_project_root,
        )
    except Exception:  # noqa: BLE001 - an unreadable vault offers nothing
        logger.debug("Could not list the server vault's project folders")
        return []
    return [
        ProjectFolderCandidate(
            name=entry["name"],
            folder=entry["folder"],
            source_name="Obsidian",
            has_todo=bool(entry.get("has_todo")),
        )
        for entry in folders
    ]


async def _device_vaults(db: AsyncSession) -> list[ProjectFolderCandidate]:
    found: list[ProjectFolderCandidate] = []
    sources = (
        await db.execute(select(DataSource).where(DataSource.kind == "obsidian_vault"))
    ).scalars()
    for source in sources:
        policy = policy_for(source)
        paths = [
            path
            for path in (
                await db.execute(
                    select(DataSourceEntry.path).where(DataSourceEntry.source_id == source.id)
                )
            ).scalars()
            # The share may have narrowed since the machine sent its index.
            if policy.shows_entry(path, is_dir=False)
        ]
        for folder, has_todo in _from_index(paths, settings.obsidian_project_root).items():
            found.append(
                ProjectFolderCandidate(
                    name=posixpath.basename(folder),
                    folder=folder,
                    source_name=source.name,
                    has_todo=has_todo,
                )
            )
    return found


async def known_project_folders(db: AsyncSession) -> list[str]:
    """Every project folder any vault shows, for the Inbox classifier to match."""
    folders = [item.folder for item in [*await _server_vault(), *await _device_vaults(db)]]
    return list(dict.fromkeys(folders))[:_LIMIT * 4]


async def project_folder_candidates(db: AsyncSession) -> list[ProjectFolderCandidate]:
    taken = {
        title.casefold()
        for title in (await db.execute(select(Project.title))).scalars()
    }
    seen: set[str] = set()
    candidates: list[ProjectFolderCandidate] = []
    for candidate in [*await _server_vault(), *await _device_vaults(db)]:
        key = candidate.name.casefold()
        if (
            key in taken
            or key in seen
            or candidate.name.startswith(".")
            or _INBOX_FOLDER.match(candidate.name)
        ):
            continue
        seen.add(key)
        candidates.append(candidate)
    candidates.sort(key=lambda item: item.name.casefold())
    return candidates[:_LIMIT]
