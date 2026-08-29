"""Security and durability tests for Obsidian vault file access."""

import os
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
from pydantic import ValidationError

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("PIN", "123456")

from services.vault import obsidian_cli_service as cli_svc # noqa: E402
from schemas.todo import TodoCreate, TodoUpdate  # noqa: E402
from services.vault.obsidian_context_service import read_project_context  # noqa: E402
from services.vault.obsidian_export_service import (  # noqa: E402
    TodoSnapshot,
    _get_file_path,
    export_todos_batch,
)
from utils.atomic_files import atomic_write_text  # noqa: E402
from utils.vault_paths import (  # noqa: E402
    VaultPathError,
    normalize_vault_relative_path,
    resolve_vault_path,
)


def test_vault_relative_path_rejects_absolute_and_traversal_paths():
    for unsafe in ("/tmp/file.md", "C:\\temp\\file.md", "../file.md", "a/../../b"):
        with pytest.raises(VaultPathError):
            normalize_vault_relative_path(unsafe)

    assert normalize_vault_relative_path("Projects\\work//TODO.md") == "Projects/work/TODO.md"


def test_vault_path_allows_missing_leaf_inside_root(tmp_path):
    resolved = resolve_vault_path(str(tmp_path), "new/project/TODO.md")
    assert resolved == str(tmp_path / "new" / "project" / "TODO.md")


def test_vault_path_rejects_symlink_parent_escape(tmp_path):
    vault = tmp_path / "vault"
    outside = tmp_path / "outside"
    vault.mkdir()
    outside.mkdir()
    try:
        (vault / "linked").symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlinks unavailable: {exc}")

    with pytest.raises(VaultPathError, match="escapes vault"):
        resolve_vault_path(str(vault), "linked/TODO.md")


def test_export_path_rejects_untrusted_source_id(tmp_path):
    with pytest.raises(VaultPathError):
        _get_file_path(str(tmp_path), None, source_id="../../outside")
    with pytest.raises(VaultPathError):
        _get_file_path(str(tmp_path), None, source_id="/tmp/outside")


def test_todo_schemas_reject_unsafe_source_id_early():
    for schema, fields in (
        (TodoCreate, {"title": "unsafe"}),
        (TodoUpdate, {}),
    ):
        with pytest.raises(ValidationError):
            schema(**fields, source_id="../../outside")

    assert TodoCreate(title="safe", source_id="Projects\\work").source_id == "Projects/work"


def test_batch_export_skips_unsafe_legacy_source_without_blocking_safe_items(tmp_path):
    def todo(todo_id: str, source_id: str) -> TodoSnapshot:
        # The value type the export actually consumes, rather than a
        # hand-listed stand-in that has to be updated whenever the export
        # reads one more field.
        return TodoSnapshot(
            id=todo_id,
            title=todo_id,
            source_id=source_id,
            status="pending",
            due_date=None,
            completed_at=None,
            priority="medium",
            tags=None,
            enabled_skills=None,
            assignee=None,
            parent_id=None,
        )

    result = export_todos_batch(
        str(tmp_path),
        [
            (todo("safe", "Projects/safe"), None),
            (todo("unsafe", "../../outside"), None),
        ],
        remove_existing=False,
    )

    assert result.exported == 1
    assert result.errors == 1
    assert (tmp_path / "Projects" / "safe" / "TODO.md").is_file()


def test_context_reader_rejects_folder_escape(tmp_path):
    outside = tmp_path.parent / "outside-context"
    outside.mkdir(exist_ok=True)
    (outside / "TODO.md").write_text("secret", encoding="utf-8")

    assert read_project_context(str(tmp_path), "../outside-context") == {
        "todo_md": "",
        "related_docs": [],
    }


def test_cli_filesystem_fallback_rejects_symlink_escape(tmp_path):
    outside = tmp_path / "outside"
    vault = tmp_path / "vault"
    outside.mkdir()
    vault.mkdir()
    try:
        (vault / "linked").symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlinks unavailable: {exc}")

    with patch.object(cli_svc.settings, "obsidian_vault_path", str(vault)), \
         patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
         patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
        with pytest.raises(VaultPathError):
            cli_svc.create_document("linked/escape.md", "blocked")

    assert not (outside / "escape.md").exists()


def test_atomic_write_failure_preserves_original_and_removes_temp_file(tmp_path):
    target = tmp_path / "TODO.md"
    target.write_text("original\n", encoding="utf-8")

    with patch("utils.atomic_files.os.replace", side_effect=OSError("replace failed")):
        with pytest.raises(OSError, match="replace failed"):
            atomic_write_text(str(target), "replacement\n")

    assert target.read_text(encoding="utf-8") == "original\n"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["TODO.md"]


def test_concurrent_appends_do_not_lose_updates(tmp_path):
    with patch.object(cli_svc.settings, "obsidian_vault_path", str(tmp_path)), \
         patch.object(cli_svc.settings, "obsidian_cli_command", ""), \
         patch.object(cli_svc.settings, "obsidian_sync_mode", "filesystem"):
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(
                lambda index: cli_svc.append_to_document(
                    "events.md", f"event-{index}\n"
                ),
                range(20),
            ))

    assert all(results)
    lines = (tmp_path / "events.md").read_text(encoding="utf-8").splitlines()
    assert sorted(lines) == sorted(f"event-{index}" for index in range(20))
