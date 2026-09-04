"""The vault export must never receive a session-bound ORM instance.

``todo_service`` hands the Obsidian export to ``asyncio.to_thread``.  A worker
thread has no greenlet context, so any attribute the export touches that the
session has expired turns a lazy load into ``MissingGreenlet`` -- from a thread
that cannot recover, inside a ``try/except`` that only logs.

Today that never fires because both session factories are built with
``expire_on_commit=False`` and every call site runs after a ``flush()``.  That
is an invariant nothing enforced.  These tests enforce it: the object crossing
the thread boundary is a plain value object, and it keeps working after the
session expires everything.
"""

import asyncio
import threading
from unittest.mock import patch

import pytest

from models.todo import Todo
from services.tasks import todo_service
from services.tasks import project_service
from services.vault import obsidian_export_service
from services.vault.obsidian_export_service import (
    TodoSnapshot,
    _todo_to_md_line,
    export_all_todos,
    export_todo,
    snapshot_todo,
)


class Capture:
    """Records what the export was called with, and on which thread."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.threads: list[threading.Thread] = []

    def __call__(self, *args, **kwargs):
        self.calls.append(args)
        self.threads.append(threading.current_thread())

    @property
    def todo(self):
        return self.calls[-1][1]


# ---------------------------------------------------------------------------
# What crosses the thread boundary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_hands_the_worker_a_snapshot_not_an_orm_instance(
    db_session, tmp_path
):
    capture = Capture()
    with (
        patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)),
        patch.object(todo_service, "export_todo", capture),
    ):
        todo = await todo_service.create_todo(db_session, title="Snapshotted")

    assert isinstance(capture.todo, TodoSnapshot)
    assert not isinstance(capture.todo, Todo)
    assert capture.todo.id == todo.id
    assert capture.todo.title == "Snapshotted"
    assert capture.threads[-1] is not threading.current_thread()


@pytest.mark.asyncio
async def test_update_hands_the_worker_a_snapshot_not_an_orm_instance(
    db_session, tmp_path
):
    todo = await todo_service.create_todo(db_session, title="Before")

    capture = Capture()
    with (
        patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)),
        patch.object(todo_service, "export_todo", capture),
    ):
        await todo_service.update_todo(db_session, todo.id, title="After")

    assert isinstance(capture.todo, TodoSnapshot)
    assert capture.todo.title == "After"


@pytest.mark.asyncio
async def test_project_tasks_share_the_project_folder_and_keep_experiment_tags(
    db_session,
    tmp_path,
):
    project = await project_service.create_project(
        db_session,
        title="P0-R Semantic referent binding",
    )

    with patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)):
        question = await todo_service.create_todo(
            db_session,
            title="E65 Question",
            parent_id=project.root_task_id,
            tags=["exp/E65"],
        )
        await todo_service.create_todo(
            db_session,
            title="E65a First run",
            parent_id=question.id,
            tags=["exp/E65a"],
        )
        await todo_service.create_todo(
            db_session,
            title="E65b Second run",
            parent_id=question.id,
            tags=["exp/E65b"],
        )

    todo_file = tmp_path / "P0-R Semantic referent binding" / "TODO.md"
    content = todo_file.read_text(encoding="utf-8")
    assert content.count("<!-- claw:") == 3
    assert "E65 Question #exp/E65" in content
    assert "E65a First run #exp/E65a" in content
    assert "E65b Second run #exp/E65b" in content
    assert not (tmp_path / "E65 Question" / "TODO.md").exists()


@pytest.mark.asyncio
async def test_full_export_uses_project_identity_and_omits_container_root(
    db_session,
    tmp_path,
):
    project = await project_service.create_project(db_session, title="SRP E65")
    question = await todo_service.create_todo(
        db_session,
        title="E65 Question",
        parent_id=project.root_task_id,
    )
    step = await todo_service.create_todo(
        db_session,
        title="E65a Run",
        parent_id=question.id,
    )
    root = await db_session.get(Todo, project.root_task_id)
    assert root is not None

    result = export_all_todos(str(tmp_path), [root, question, step])

    assert result.exported == 2
    content = (tmp_path / "SRP E65" / "TODO.md").read_text(encoding="utf-8")
    assert "E65 Question" in content
    assert "E65a Run" in content
    assert f"<!-- claw:{root.id} -->" not in content


@pytest.mark.asyncio
async def test_delete_hands_the_worker_only_the_id(db_session, tmp_path):
    """Deletion never had the problem; pin it so it stays that way."""
    todo = await todo_service.create_todo(db_session, title="Doomed")

    capture = Capture()
    with (
        patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)),
        patch.object(todo_service, "remove_todo_from_vault", capture),
    ):
        await todo_service.delete_todo(db_session, todo.id)

    assert capture.calls[-1][1] == todo.id
    assert isinstance(capture.calls[-1][1], str)


# ---------------------------------------------------------------------------
# The invariant itself: the snapshot survives an expired session
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_snapshot_still_renders_after_the_session_expires(
    db_session, tmp_path
):
    """This is the test that fails if anyone flips ``expire_on_commit``.

    ``expire_all()`` reproduces exactly what ``expire_on_commit=True`` does at
    commit time.  Rendering the snapshot on a worker thread afterwards must
    still work, because it holds values rather than a session handle.
    """
    capture = Capture()
    with (
        patch.object(todo_service.settings, "obsidian_vault_path", str(tmp_path)),
        patch.object(todo_service, "export_todo", capture),
    ):
        await todo_service.create_todo(db_session, title="Expired session")

    db_session.expire_all()

    line = await asyncio.to_thread(_todo_to_md_line, capture.todo)
    assert "Expired session" in line


@pytest.mark.asyncio
async def test_an_expired_orm_instance_is_exactly_what_the_snapshot_avoids(
    db_session,
):
    """Demonstrates the hazard the snapshot removes.

    If ``todo_service`` ever goes back to offloading the ORM instance, this is
    the failure it would hit the first time a session expired it.
    """
    todo = await todo_service.create_todo(db_session, title="Bound to a session")
    db_session.expire_all()

    with pytest.raises(BaseException) as excinfo:
        await asyncio.to_thread(_todo_to_md_line, todo)
    assert type(excinfo.value).__name__ in {
        "MissingGreenlet",
        "InvalidRequestError",
        "DetachedInstanceError",
    }, f"unexpected error type: {type(excinfo.value).__name__}"

    # And the snapshot taken while the attributes were loaded is unaffected.
    await db_session.refresh(todo)
    assert "Bound to a session" in _todo_to_md_line(snapshot_todo(todo))


# ---------------------------------------------------------------------------
# Widening the public API must not change what any existing caller gets
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_renders_an_orm_instance_and_its_snapshot_identically(
    db_session, tmp_path
):
    """Synchronous callers outside ``todo_service`` still pass ``Todo``."""
    todo = await todo_service.create_todo(
        db_session,
        title="Parity",
        priority="high",
        tags=["work"],
        enabled_skills=["plan"],
    )

    assert _todo_to_md_line(snapshot_todo(todo)) == _todo_to_md_line(
        snapshot_todo(snapshot_todo(todo))
    )

    vault = tmp_path / "vault"
    vault.mkdir()
    export_todo(str(vault), todo)
    from_orm = (vault / "00_Inbox" / "TODO.md").read_text()

    (vault / "00_Inbox" / "TODO.md").unlink()
    export_todo(str(vault), snapshot_todo(todo))
    from_snapshot = (vault / "00_Inbox" / "TODO.md").read_text()

    assert from_orm == from_snapshot
    assert todo.id in from_orm


def test_snapshot_covers_every_field_the_export_reads():
    """A canary: a new todo field used by the export must join ``TodoSnapshot``.

    Without this, adding ``todo.foo`` to the renderer would keep working for
    the synchronous callers that still pass a ``Todo`` and raise
    ``AttributeError`` only on the offloaded path, inside a bare ``except``
    that logs and moves on.
    """
    import inspect
    import re

    source = "".join(
        inspect.getsource(function)
        for function in (
            obsidian_export_service._todo_to_md_line,
            obsidian_export_service._export_group,
            obsidian_export_service.export_todos_batch,
            obsidian_export_service.export_all_todos,
        )
    )
    read = set(re.findall(r"\btodo\.([a-z_]+)", source))
    fields = {field.name for field in TodoSnapshot.__dataclass_fields__.values()}

    assert read, "the scrape found nothing; the canary would never fire"
    assert read <= fields, f"export reads fields the snapshot lacks: {read - fields}"
