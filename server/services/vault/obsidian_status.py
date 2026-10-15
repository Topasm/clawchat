"""One answer to "is Obsidian usable here, and how?".

``/api/obsidian/status``, ``/api/obsidian/health`` and the index refresh all
read availability from here, so they cannot disagree about whether the CLI
works or which mode the vault is in. The CLI is probed by running
``<cli> version``; the result is cached for a short while because the probe can
wait several seconds on a missing or hung binary.
"""

import logging
import os
import subprocess
import threading
import time
from dataclasses import asdict, dataclass

from config import settings

logger = logging.getLogger(__name__)

_CLI_PROBE_TTL_SECONDS = 60.0
_CLI_PROBE_TIMEOUT_SECONDS = 5


@dataclass(frozen=True)
class _CliProbe:
    command: str
    ok: bool
    checked_at: float


_cli_probe: _CliProbe | None = None
_cli_probe_lock = threading.Lock()


@dataclass(frozen=True)
class ObsidianAvailability:
    vault_configured: bool
    vault_available: bool
    vault_path: str
    cli_configured: bool
    cli_available: bool
    companion_online: bool
    mode: str
    """``cli`` when the CLI answers, ``filesystem`` when only the vault is
    configured, ``disabled`` when there is no vault."""
    project_root: str
    index_state: str
    """``disabled``, ``pending`` (no scan yet), ``scanning``, ``ready`` or
    ``error``."""

    def as_dict(self) -> dict:
        return asdict(self)


def probe_cli(*, force: bool = False) -> bool:
    """Return whether the configured Obsidian CLI answers ``version``."""
    global _cli_probe

    command = settings.obsidian_cli_command
    if not command:
        return False
    with _cli_probe_lock:
        cached = _cli_probe
    if (
        not force
        and cached is not None
        and cached.command == command
        and time.monotonic() - cached.checked_at < _CLI_PROBE_TTL_SECONDS
    ):
        return cached.ok

    try:
        proc = subprocess.run(
            [command, "version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_CLI_PROBE_TIMEOUT_SECONDS,
        )
        ok = proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        ok = False
    with _cli_probe_lock:
        _cli_probe = _CliProbe(command=command, ok=ok, checked_at=time.monotonic())
    return ok


def reset_cli_probe() -> None:
    """Forget the cached probe (tests, or after the CLI setting changes)."""
    global _cli_probe
    with _cli_probe_lock:
        _cli_probe = None


def check_companion_online(vault_path: str) -> bool:
    """Heuristic check for whether the companion node is online.

    - In ``livesync`` mode: checks if the LiveSync plugin is configured
      (``data.json`` exists in the plugin directory and was touched within the
      hour) as a proxy for CouchDB connectivity.
    - In ``filesystem`` mode: checks if ``.obsidian/workspace.json`` was
      modified within 10 minutes, suggesting an active Obsidian instance.
    """
    if not vault_path:
        return False
    obsidian_dir = os.path.join(vault_path, ".obsidian")
    if not os.path.isdir(obsidian_dir):
        return False

    if settings.obsidian_sync_mode == "livesync":
        livesync_data = os.path.join(
            obsidian_dir, "plugins", "obsidian-livesync", "data.json"
        )
        try:
            return time.time() - os.path.getmtime(livesync_data) < 3600
        except OSError:
            return False

    try:
        workspace_file = os.path.join(obsidian_dir, "workspace.json")
        return time.time() - os.path.getmtime(workspace_file) < 600
    except OSError:
        return False


def get_availability() -> ObsidianAvailability:
    """Compute Obsidian availability. Blocking: may probe the CLI."""
    from services.vault.obsidian_vault_indexer import index_state

    vault_path = settings.obsidian_vault_path
    vault_configured = bool(vault_path)
    vault_available = vault_configured and os.path.isdir(vault_path)
    cli_available = vault_available and probe_cli()
    if cli_available:
        mode = "cli"
    elif vault_configured:
        mode = "filesystem"
    else:
        mode = "disabled"
    return ObsidianAvailability(
        vault_configured=vault_configured,
        vault_available=vault_available,
        vault_path=vault_path,
        cli_configured=bool(settings.obsidian_cli_command),
        cli_available=cli_available,
        companion_online=vault_available and check_companion_online(vault_path),
        mode=mode,
        project_root=settings.obsidian_project_root,
        index_state=index_state(),
    )
