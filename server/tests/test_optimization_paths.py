import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import event

from models.conversation import Conversation
from models.event import Event
from models.execution_host import ExecutionHost
from models.message import Message
from models.project import Project
from models.todo import Todo
from routers.chat import list_conversations
from routers.todo import list_projects
from services.vault.obsidian_export_service import export_all_todos
from services.calendar.scheduling_service import _merge_intervals, find_conflicts, find_free_slots
from services.tasks import project_service


@pytest.mark.asyncio
async def test_project_and_conversation_lists_use_constant_query_counts(db_session):
    roots = [Todo(title=f"Project {index}") for index in range(3)]
    db_session.add_all(roots)
    await db_session.flush()

    for root in roots:
        db_session.add_all([
            Todo(title="Open", parent_id=root.id),
            Todo(title="Done", parent_id=root.id, status="completed"),
        ])
        conversation = Conversation(title=root.title, project_todo_id=root.id)
        db_session.add(conversation)
        await db_session.flush()
        db_session.add(Message(
            conversation_id=conversation.id,
            role="user",
            content=f"Latest for {root.title}",
        ))
    await db_session.commit()

    statements = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        projects = await list_projects(db=db_session, _user="user")
        assert len(projects) == 3
        assert len(statements) == 1

        statements.clear()
        conversations = await list_conversations(
            page=1,
            limit=20,
            archived=False,
            project_todo_id=None,
            db=db_session,
            _user="user",
        )
        assert len(conversations.items) == 3
        assert all(item.last_message.startswith("Latest") for item in conversations.items)
        assert len(statements) == 2
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)


@pytest.mark.asyncio
async def test_first_class_project_responses_load_hosts_in_the_main_query(db_session):
    hosts = [
        ExecutionHost(
            id=f"host_{index}",
            label=f"Machine {index}",
            kind="worker",
            last_seen_at=datetime.now(timezone.utc),
        )
        for index in range(3)
    ]
    projects = [
        Project(
            id=f"project_{index}",
            title=f"Project {index}",
            execution_host_id=host.id,
        )
        for index, host in enumerate(hosts)
    ]
    db_session.add_all([*hosts, *projects])
    await db_session.commit()
    project_id = projects[1].id
    db_session.sync_session.expunge_all()

    statements = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        listed = {
            item.id: item for item in await project_service.list_projects(db_session)
        }
        assert {
            project_id: item.execution_host_label for project_id, item in listed.items()
        } == {
            "project_0": "Machine 0",
            "project_1": "Machine 1",
            "project_2": "Machine 2",
        }
        assert all(item.execution_host_online is True for item in listed.values())
        assert len(statements) == 1

        selected_project = await db_session.get(Project, project_id)
        assert selected_project is not None
        statements.clear()
        selected = await project_service.build_project_response(
            db_session,
            selected_project,
        )
        assert selected.id == project_id
        assert selected.execution_host_label == "Machine 1"
        assert len(statements) == 1
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)


def test_full_obsidian_export_walks_vault_once(tmp_path):
    inbox = tmp_path / "00_Inbox" / "TODO.md"
    inbox.parent.mkdir()
    inbox.write_text(
        "## ClawChat\n"
        "- [ ] Old A <!-- claw:a -->\n"
        "- [ ] Old B <!-- claw:b -->\n",
        encoding="utf-8",
    )
    (tmp_path / "notes.md").write_text("# Notes\n", encoding="utf-8")

    todos = [
        SimpleNamespace(
            id=todo_id,
            title=f"New {todo_id.upper()}",
            parent_id=None,
            source_id=None,
            status="pending",
            due_date=None,
            completed_at=None,
            priority="medium",
            tags=None,
            enabled_skills=None,
            assignee=None,
        )
        for todo_id in ("a", "b")
    ]

    with patch(
        "services.vault.obsidian_export_service.os.walk",
        wraps=os.walk,
    ) as walk:
        result = export_all_todos(str(tmp_path), todos)

    assert walk.call_count == 1
    assert result.exported == 2
    content = inbox.read_text(encoding="utf-8")
    assert content.count("<!-- claw:a -->") == 1
    assert content.count("<!-- claw:b -->") == 1
    assert "New A" in content
    assert "New B" in content


def test_merge_intervals_combines_overlaps_and_adjacent_ranges():
    from datetime import datetime, timezone

    at = lambda hour: datetime(2026, 8, 27, hour, tzinfo=timezone.utc)
    assert _merge_intervals([
        (at(12), at(13)),
        (at(9), at(11)),
        (at(10), at(12)),
        (at(15), at(16)),
    ]) == [
        (at(9), at(13)),
        (at(15), at(16)),
    ]


@pytest.mark.asyncio
async def test_free_slots_sweep_respects_range_and_busy_intervals(db_session):
    from datetime import datetime, timezone

    at = lambda hour: datetime(2026, 8, 27, hour, tzinfo=timezone.utc)
    db_session.add(Event(title="Busy", start_time=at(10), end_time=at(11)))
    await db_session.commit()

    slots = await find_free_slots(
        db_session,
        at(9),
        at(17),
        duration_minutes=60,
    )

    assert [(slot["start"], slot["end"]) for slot in slots] == [
        (at(9).isoformat(), at(10).isoformat()),
        (at(11).isoformat(), at(17).isoformat()),
    ]


@pytest.mark.asyncio
async def test_recurring_conflicts_handle_sqlite_naive_datetimes(db_session):
    from datetime import datetime, timezone

    at = lambda day, hour: datetime(2026, 8, day, hour, tzinfo=timezone.utc)
    db_session.add(Event(
        title="Weekly",
        start_time=at(20, 10),
        end_time=at(20, 11),
        recurrence_rule="FREQ=WEEKLY",
    ))
    await db_session.commit()

    conflicts = await find_conflicts(db_session, at(27, 9), at(27, 17))

    assert len(conflicts) == 1
    assert conflicts[0]["title"] == "Weekly"
    assert conflicts[0]["is_occurrence"] is True
    assert conflicts[0]["start_time"] == at(27, 10).isoformat()
