"""Every response datetime leaves with its zone."""

from datetime import datetime, timezone

from schemas.agent_run import AgentRunResponse
from schemas.todo import TodoResponse


def test_naive_stored_datetimes_serialise_as_utc():
    todo = TodoResponse(
        id="todo_1",
        title="t",
        status="pending",
        priority="medium",
        created_at=datetime(2026, 10, 2, 1, 2, 3),
        updated_at=datetime(2026, 10, 2, 1, 2, 3),
        due_date=datetime(2026, 10, 3, 14, 59),
    )
    payload = todo.model_dump(mode="json")
    assert payload["created_at"] == "2026-10-02T01:02:03Z"
    assert payload["due_date"] == "2026-10-03T14:59:00Z"
    assert payload["completed_at"] is None


def test_aware_datetimes_keep_their_zone():
    todo = TodoResponse(
        id="todo_2",
        title="t",
        status="pending",
        priority="medium",
        created_at=datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc),
    )
    assert todo.model_dump(mode="json")["created_at"] == "2026-10-02T10:00:00Z"


def test_run_timestamps_are_zoned_too():
    run = AgentRunResponse(
        id="run_1",
        agent_task_id="task_1",
        task_type="delegate_research",
        instruction="x",
        instruction_snapshot="x",
        attempt=1,
        provider="openclaw",
        status="running",
        progress=0,
        created_at=datetime(2026, 10, 2, 0, 0),
        updated_at=datetime(2026, 10, 2, 0, 0),
    )
    payload = run.model_dump(mode="json")
    assert payload["created_at"].endswith("Z")
    assert payload["started_at"] is None
