"""Canonical path boundary for all Obsidian vault filesystem access."""

import ntpath
from pathlib import Path


class VaultPathError(ValueError):
    """Raised when a requested path is not a safe child of its vault."""


def normalize_vault_relative_path(path: str, *, allow_empty: bool = False) -> str:
    """Return a normalized vault-relative path and reject escape attempts."""
    if not isinstance(path, str):
        raise VaultPathError("Vault path must be a string")
    if "\x00" in path:
        raise VaultPathError("Vault path must not contain NUL bytes")

    normalized = path.replace("\\", "/")
    drive, _tail = ntpath.splitdrive(normalized)
    if drive or normalized.startswith("/"):
        raise VaultPathError(f"Absolute vault path not allowed: {path}")

    raw_parts = normalized.split("/")
    if ".." in raw_parts:
        raise VaultPathError(f"Path traversal not allowed: {path}")

    parts = [part for part in raw_parts if part not in ("", ".")]
    if not parts and not allow_empty:
        raise VaultPathError("Vault path must not be empty")
    return "/".join(parts)


def resolve_vault_path(
    vault_path: str,
    relative_path: str,
    *,
    allow_empty: bool = False,
    must_exist: bool = False,
) -> str:
    """Resolve a vault child while preventing traversal and symlink escapes.

    ``Path.resolve(strict=False)`` canonicalizes every existing ancestor, so a
    missing writable leaf is still rejected when one of its parents is a
    symlink pointing outside the vault.
    """
    relative = normalize_vault_relative_path(
        relative_path, allow_empty=allow_empty
    )
    root = Path(vault_path).expanduser().resolve(strict=False)
    if not root.is_dir():
        raise VaultPathError(f"Vault path is not a directory: {vault_path}")

    requested = root.joinpath(*relative.split("/")) if relative else root
    canonical = requested.resolve(strict=False)
    try:
        canonical.relative_to(root)
    except ValueError as exc:
        raise VaultPathError(f"Path escapes vault root: {relative_path}") from exc

    if must_exist and not canonical.exists():
        raise VaultPathError(f"Vault path does not exist: {relative_path}")
    return str(requested)
