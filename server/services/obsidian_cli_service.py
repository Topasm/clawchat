"""Obsidian CLI wrapper with filesystem fallback and offline write queue.

Wraps the ``obsidian`` CLI for document operations (create, append, search,
rename/move).  When the CLI is unavailable or the companion node is offline,
write operations are queued for later replay and filesystem fallback is used
where possible.
"""

import json
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from config import settings

logger = logging.getLogger(__name__)

_QUEUE_FILE = "data/obsidian_write_queue.json"


@dataclass
class WriteOp:
    """A queued write operation."""
    op: str                # "create", "append", "rename", "move"
    args: dict             # operation-specific arguments
    queued_at: float = 0.0
    retries: int = 0
    error: str | None = None


# In-memory write queue
_write_queue: list[WriteOp] = []


# ---------------------------------------------------------------------------
# CLI execution helper
# ---------------------------------------------------------------------------


def _run_cli(*args: str, timeout: int = 15) -> subprocess.CompletedProcess | None:
    """Run the configured Obsidian CLI with the given arguments.

    Returns the CompletedProcess on success, or None if the CLI is not
    configured or the command fails.
    """
    cli = settings.obsidian_cli_command
    if not cli:
        return None

    cmd = [cli, *args]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0:
            logger.debug(
                "CLI command failed (rc=%d): %s\nstderr: %s",
                proc.returncode,
                " ".join(cmd),
                proc.stderr.strip(),
            )
            return None
        return proc
    except FileNotFoundError:
        logger.warning("Obsidian CLI not found: %s", cli)
        return None
    except subprocess.TimeoutExpired:
        logger.warning("Obsidian CLI timed out: %s", " ".join(cmd))
        return None
    except OSError as exc:
        logger.warning("Obsidian CLI error: %s", exc)
        return None


def is_cli_available() -> bool:
    """Check if the Obsidian CLI is configured and responsive."""
    if not settings.obsidian_cli_command:
        return False
    result = _run_cli("version", timeout=5)
    return result is not None


# ---------------------------------------------------------------------------
# Document operations — CLI-first with filesystem fallback
# ---------------------------------------------------------------------------


def create_document(
    vault_relative_path: str,
    content: str = "",
    *,
    use_cli: bool = True,
    queue_on_fail: bool = True,
) -> bool:
    """Create a new markdown document in the vault.

    Tries CLI first (to get Obsidian metadata tracking), falls back to
    filesystem, and queues for later if both fail and companion is required.
    """
    vault = settings.obsidian_vault_path
    if not vault:
        return False

    # Try CLI
    if use_cli:
        result = _run_cli("create", f"path={vault_relative_path}", f"content={content}")
        if result is not None:
            logger.debug("Created document via CLI: %s", vault_relative_path)
            return True

    # Filesystem fallback
    abs_path = os.path.join(vault, vault_relative_path)
    try:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
        logger.debug("Created document via filesystem: %s", vault_relative_path)
        return True
    except OSError as exc:
        logger.error("Failed to create document %s: %s", vault_relative_path, exc)
        if queue_on_fail and settings.obsidian_companion_node_required:
            _enqueue(WriteOp(
                op="create",
                args={"path": vault_relative_path, "content": content},
                queued_at=time.time(),
            ))
        return False


def append_to_document(
    vault_relative_path: str,
    content: str,
    *,
    use_cli: bool = True,
    queue_on_fail: bool = True,
) -> bool:
    """Append content to an existing document.

    Creates the file if it does not exist.
    """
    vault = settings.obsidian_vault_path
    if not vault:
        return False

    # Try CLI
    if use_cli:
        result = _run_cli("append", f"path={vault_relative_path}", f"content={content}")
        if result is not None:
            logger.debug("Appended to document via CLI: %s", vault_relative_path)
            return True

    # Filesystem fallback
    abs_path = os.path.join(vault, vault_relative_path)
    try:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "a", encoding="utf-8") as f:
            f.write(content)
        logger.debug("Appended to document via filesystem: %s", vault_relative_path)
        return True
    except OSError as exc:
        logger.error("Failed to append to %s: %s", vault_relative_path, exc)
        if queue_on_fail and settings.obsidian_companion_node_required:
            _enqueue(WriteOp(
                op="append",
                args={"path": vault_relative_path, "content": content},
                queued_at=time.time(),
            ))
        return False


def rename_document(
    vault_relative_path: str,
    new_name: str,
    *,
    use_cli: bool = True,
) -> bool:
    """Rename a document (CLI preferred to update internal links)."""
    vault = settings.obsidian_vault_path
    if not vault:
        return False

    # CLI is strongly preferred for rename — it updates internal links
    if use_cli:
        result = _run_cli("rename", f"path={vault_relative_path}", f"name={new_name}")
        if result is not None:
            logger.debug("Renamed document via CLI: %s -> %s", vault_relative_path, new_name)
            return True

    # Filesystem fallback (no link update)
    abs_old = os.path.join(vault, vault_relative_path)
    parent = os.path.dirname(abs_old)
    abs_new = os.path.join(parent, new_name)
    try:
        os.rename(abs_old, abs_new)
        logger.debug("Renamed document via filesystem (no link update): %s -> %s", vault_relative_path, new_name)
        return True
    except OSError as exc:
        logger.error("Failed to rename %s: %s", vault_relative_path, exc)
        return False


def move_document(
    vault_relative_path: str,
    new_folder: str,
    *,
    use_cli: bool = True,
) -> bool:
    """Move a document to a different folder (CLI preferred for link update)."""
    vault = settings.obsidian_vault_path
    if not vault:
        return False

    filename = os.path.basename(vault_relative_path)
    new_path = os.path.join(new_folder, filename)

    # CLI preferred for move — updates internal links
    if use_cli:
        result = _run_cli("move", f"path={vault_relative_path}", f"to={new_path}")
        if result is not None:
            logger.debug("Moved document via CLI: %s -> %s", vault_relative_path, new_path)
            return True

    # Filesystem fallback
    abs_old = os.path.join(vault, vault_relative_path)
    abs_new = os.path.join(vault, new_path)
    try:
        os.makedirs(os.path.dirname(abs_new), exist_ok=True)
        shutil.move(abs_old, abs_new)
        logger.debug("Moved document via filesystem (no link update): %s -> %s", vault_relative_path, new_path)
        return True
    except OSError as exc:
        logger.error("Failed to move %s: %s", vault_relative_path, exc)
        return False


def search_vault(query: str, max_results: int = 10) -> list[dict[str, str]]:
    """Search the vault using CLI.

    Returns a list of dicts with 'path' and 'match' keys.
    Falls back to simple filename grep if CLI is unavailable.
    """
    vault = settings.obsidian_vault_path
    if not vault:
        return []

    # Try CLI search
    result = _run_cli("search", f"query={query}", timeout=10)
    if result is not None:
        matches = []
        for line in result.stdout.strip().splitlines()[:max_results]:
            line = line.strip()
            if line:
                matches.append({"path": line, "match": ""})
        return matches

    # Filesystem fallback — search filenames
    matches = []
    query_lower = query.lower()
    for dirpath, _dirs, filenames in os.walk(vault):
        if ".obsidian" in dirpath:
            continue
        for fname in filenames:
            if not fname.endswith(".md"):
                continue
            if query_lower in fname.lower():
                rel = os.path.relpath(os.path.join(dirpath, fname), vault)
                matches.append({"path": rel, "match": fname})
                if len(matches) >= max_results:
                    return matches

    return matches


def list_cli_commands() -> list[str]:
    """List available Obsidian CLI plugin commands."""
    result = _run_cli("commands", timeout=10)
    if result is None:
        return []
    return [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Write queue management
# ---------------------------------------------------------------------------


def _enqueue(op: WriteOp) -> None:
    """Add an operation to the write queue."""
    _write_queue.append(op)
    _persist_queue()
    logger.info("Queued write operation: %s for %s", op.op, op.args.get("path", "?"))


def get_queue_status() -> dict:
    """Return the current write queue status."""
    return {
        "pending": len(_write_queue),
        "operations": [
            {
                "op": op.op,
                "path": op.args.get("path", ""),
                "queued_at": op.queued_at,
                "retries": op.retries,
                "error": op.error,
            }
            for op in _write_queue
        ],
    }


def flush_queue() -> dict:
    """Attempt to replay all queued write operations.

    Returns a summary of results.
    """
    if not _write_queue:
        return {"processed": 0, "succeeded": 0, "failed": 0}

    succeeded = 0
    failed = 0
    remaining: list[WriteOp] = []

    for op in _write_queue:
        ok = _replay_op(op)
        if ok:
            succeeded += 1
        else:
            op.retries += 1
            remaining.append(op)
            failed += 1

    _write_queue.clear()
    _write_queue.extend(remaining)
    _persist_queue()

    total = succeeded + failed
    logger.info("Flushed write queue: %d/%d succeeded", succeeded, total)

    return {"processed": total, "succeeded": succeeded, "failed": failed}


def clear_queue() -> int:
    """Clear all queued operations. Returns the number cleared."""
    count = len(_write_queue)
    _write_queue.clear()
    _persist_queue()
    return count


def _replay_op(op: WriteOp) -> bool:
    """Replay a single queued operation."""
    try:
        if op.op == "create":
            return create_document(
                op.args["path"],
                op.args.get("content", ""),
                use_cli=True,
                queue_on_fail=False,
            )
        elif op.op == "append":
            return append_to_document(
                op.args["path"],
                op.args["content"],
                use_cli=True,
                queue_on_fail=False,
            )
        else:
            logger.warning("Unknown queued op type: %s", op.op)
            return False
    except Exception as exc:
        op.error = str(exc)
        return False


def _persist_queue() -> None:
    """Save the write queue to disk for crash recovery."""
    try:
        data = [
            {
                "op": op.op,
                "args": op.args,
                "queued_at": op.queued_at,
                "retries": op.retries,
                "error": op.error,
            }
            for op in _write_queue
        ]
        os.makedirs(os.path.dirname(_QUEUE_FILE), exist_ok=True)
        with open(_QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        logger.debug("Could not persist write queue")


def load_queue() -> None:
    """Load the write queue from disk on startup."""
    global _write_queue
    if not os.path.isfile(_QUEUE_FILE):
        return
    try:
        with open(_QUEUE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _write_queue = [
            WriteOp(
                op=item["op"],
                args=item["args"],
                queued_at=item.get("queued_at", 0),
                retries=item.get("retries", 0),
                error=item.get("error"),
            )
            for item in data
        ]
        if _write_queue:
            logger.info("Loaded %d queued write operations from disk", len(_write_queue))
    except (OSError, json.JSONDecodeError, KeyError):
        logger.debug("Could not load write queue from disk")
