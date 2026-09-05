"""Module-intent handling in the orchestrator.

These run the resolver directly: it is the half both chat transports share, so
covering it covers WebSocket and SSE at once.
"""

from datetime import datetime, timezone
import json

import pytest
from sqlalchemy import select

from domain.task import TaskStatus
from models.event import Event
from models.plan_proposal import PlanProposal
from models.todo import Todo
from schemas.task import PlanApplyRequest, PlanPayload
from services.chat.orchestrator import Orchestrator
from utils import make_id


class NullWebSocketManager:
    async def send_json(self, *args, **kwargs):
        return None


class StubAI:
    async def stream_completion(self, messages):
        yield ""

    async def generate_title(self, content: str) -> str:
        return "Title"


@pytest.fixture
def orchestrator(session_factory):
    return Orchestrator(
        ai_service=StubAI(),
        ws_manager=NullWebSocketManager(),
        session_factory=session_factory,
    )


async def _resolve(orchestrator, db, intent, params, content=""):
    return await orchestrator.resolve_intent_response(db, None, intent, params, content)


# --- create ---------------------------------------------------------------


async def test_create_todo_persists_the_task(orchestrator, db_session):
    text, metadata = await _resolve(
        orchestrator, db_session, "create_todo", {"title": "Buy milk"}
    )

    todos = (
        (await db_session.execute(select(Todo).where(Todo.title == "Buy milk")))
        .scalars()
        .all()
    )
    assert len(todos) == 1
    assert metadata["module"] == "todos"
    assert "Buy milk" in text


# --- completion + recurrence ---------------------------------------------


async def _recurring(db, **overrides) -> Todo:
    todo = Todo(
        id=make_id("todo_"),
        title="Water the plants",
        status=TaskStatus.PENDING,
        priority="medium",
        due_date=datetime(2026, 8, 28, tzinfo=timezone.utc),
        recurrence_rule="FREQ=DAILY",
        **overrides,
    )
    db.add(todo)
    await db.flush()
    return todo


async def test_completing_a_recurring_task_by_chat_continues_the_series(
    orchestrator, db_session
):
    """Only the REST update used to spawn the next occurrence, so saying
    "done" in chat silently ended the series."""
    await _recurring(db_session)

    text, metadata = await _resolve(
        orchestrator, db_session, "complete_todo", {"title": "Water the plants"}
    )

    pending = (
        (
            await db_session.execute(
                select(Todo).where(
                    Todo.title == "Water the plants",
                    Todo.status == TaskStatus.PENDING,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(pending) == 1
    assert pending[0].due_date.date() == datetime(2026, 8, 29).date()
    assert metadata["next_todo_id"] == pending[0].id
    assert "2026-08-29" in text


async def test_recompleting_a_recurring_task_by_chat_does_not_duplicate_the_series(
    orchestrator, db_session
):
    original = await _recurring(db_session)
    original.status = TaskStatus.COMPLETED
    original.completed_at = datetime.now(timezone.utc)
    await db_session.flush()

    _text, metadata = await _resolve(
        orchestrator, db_session, "complete_todo", {"title": "Water the plants"}
    )

    assert "next_todo_id" not in metadata
    pending = (
        (
            await db_session.execute(
                select(Todo).where(
                    Todo.title == "Water the plants",
                    Todo.status == TaskStatus.PENDING,
                )
            )
        )
        .scalars()
        .all()
    )
    assert pending == []


async def test_completing_a_non_recurring_task_spawns_nothing(orchestrator, db_session):
    todo = Todo(
        id=make_id("todo_"),
        title="One off",
        status=TaskStatus.PENDING,
        priority="medium",
    )
    db_session.add(todo)
    await db_session.flush()

    _text, metadata = await _resolve(
        orchestrator, db_session, "complete_todo", {"title": "One off"}
    )

    assert "next_todo_id" not in metadata
    remaining = (
        (
            await db_session.execute(
                select(Todo).where(Todo.status == TaskStatus.PENDING)
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []


async def test_completing_a_finished_series_spawns_nothing(orchestrator, db_session):
    await _recurring(
        db_session, recurrence_end=datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)
    )

    _text, metadata = await _resolve(
        orchestrator, db_session, "complete_todo", {"title": "Water the plants"}
    )

    assert "next_todo_id" not in metadata


# --- lookups that cannot resolve -----------------------------------------


async def test_completing_an_unknown_task_reports_it(orchestrator, db_session):
    text, metadata = await _resolve(
        orchestrator, db_session, "complete_todo", {"title": "Nonexistent"}
    )

    assert metadata is None
    assert "couldn't find" in text


async def test_completing_without_a_title_asks_for_one(orchestrator, db_session):
    text, metadata = await _resolve(orchestrator, db_session, "complete_todo", {})

    assert metadata is None
    assert "Which task" in text


# --- queries --------------------------------------------------------------


async def test_query_todos_on_an_empty_list(orchestrator, db_session):
    text, metadata = await _resolve(orchestrator, db_session, "query_todos", {})

    assert metadata is None
    assert "don't have any tasks" in text


# --- routing --------------------------------------------------------------


async def test_general_chat_has_no_self_contained_answer(orchestrator, db_session):
    """None tells the caller to stream a completion instead."""
    assert await _resolve(orchestrator, db_session, "general_chat", {}) is None


async def test_delegate_task_is_confirmed_and_started(
    orchestrator, db_session, monkeypatch
):
    """Delegation used to return None here, so the SSE transport never
    delegated at all. Both transports now get the confirmation and the run."""
    from models.agent_run import AgentRun
    from models.agent_task import AgentTask
    from services.agents import agent_run_service

    launched: list[str] = []

    def _record_launch(run_id, coroutine):
        coroutine.close()
        launched.append(run_id)

    monkeypatch.setattr(agent_run_service, "launch_execution", _record_launch)

    text, metadata = await _resolve(
        orchestrator,
        db_session,
        "delegate_task",
        {"instruction": "Summarize the meeting notes", "task_type": "summarize"},
    )

    task = (await db_session.execute(select(AgentTask))).scalars().one()
    run = (await db_session.execute(select(AgentRun))).scalars().one()
    assert task.instruction == "Summarize the meeting notes"
    assert run.agent_task_id == task.id
    assert launched == [run.id]
    assert metadata["action_type"] == "task_delegated"
    assert metadata["task_id"] == task.id
    assert metadata["run_id"] == run.id
    assert metadata["todo_id"] is None
    assert task.id in text


async def test_create_todo_nests_under_a_named_parent(orchestrator, db_session):
    parent = Todo(
        id=make_id("todo_"), title="Write the paper", status=TaskStatus.PENDING
    )
    db_session.add(parent)
    await db_session.commit()

    text, metadata = await _resolve(
        orchestrator,
        db_session,
        "create_todo",
        {"title": "Draft the abstract", "parent_title": "write the paper"},
    )

    step = (
        await db_session.execute(select(Todo).where(Todo.title == "Draft the abstract"))
    ).scalar_one()
    assert step.parent_id == parent.id
    assert metadata["parent_id"] == parent.id
    assert "under 'Write the paper'" in text


async def test_create_todo_with_unknown_parent_creates_nothing(
    orchestrator, db_session
):
    text, metadata = await _resolve(
        orchestrator,
        db_session,
        "create_todo",
        {"title": "Draft the abstract", "parent_title": "no such task"},
    )
    assert metadata is None
    assert "no such task" in text
    assert (await db_session.execute(select(Todo))).scalars().all() == []


async def test_create_todo_resolves_a_named_parent_inside_the_thread_project(
    orchestrator, db_session
):
    from models.conversation import Conversation
    from models.project import Project

    first = Project(id="project_parent_first", title="First")
    second = Project(id="project_parent_second", title="Second")
    db_session.add_all([first, second])
    await db_session.flush()
    first_parent = Todo(
        id="todo_parent_first",
        title="Shared parent",
        project_id=first.id,
        status=TaskStatus.PENDING,
    )
    second_parent = Todo(
        id="todo_parent_second",
        title="Shared parent",
        project_id=second.id,
        status=TaskStatus.PENDING,
    )
    db_session.add_all([first_parent, second_parent])
    await db_session.flush()
    first.root_task_id = first_parent.id
    second.root_task_id = second_parent.id
    conversation = Conversation(
        id="conv_parent_first",
        title="First Project Agent",
        project_id=first.id,
        project_todo_id=first_parent.id,
    )
    db_session.add(conversation)
    await db_session.flush()

    _text, metadata = await orchestrator.resolve_intent_response(
        db_session,
        conversation.id,
        "create_todo",
        {"title": "Child", "parent_title": "Shared parent"},
        "Add a child under Shared parent",
    )

    proposal = await db_session.get(PlanProposal, metadata["plan_proposal_id"])
    assert proposal.root_task_id == first_parent.id


async def test_create_todo_from_task_agent_is_a_revisioned_apply_and_undo_proposal(
    orchestrator, db_session
):
    from services.planning import plan_proposal_service

    parent, conversation = await _task_thread(db_session, as_project_root=False)

    text, metadata = await orchestrator.resolve_intent_response(
        db_session,
        conversation.id,
        "create_todo",
        {
            "title": "Check support terms",
            "description": "Compare response-time commitments",
            "due_date": "2026-09-12",
        },
        "지원 조건 확인 단계를 추가해줘",
    )

    proposal = await db_session.get(PlanProposal, metadata["plan_proposal_id"])
    payload = PlanPayload.model_validate_json(proposal.payload_json)
    assert metadata["action_type"] == "plan_started"
    assert metadata["proposal_kind"] == "add_task"
    assert metadata["todo_id"] == parent.id
    assert "Apply the graph change" in text
    assert proposal.status == "draft"
    assert proposal.base_graph_revision is not None
    assert payload.subtasks[0].title == "Check support terms"
    assert payload.subtasks[0].description == "Compare response-time commitments"
    assert payload.subtasks[0].due_date.isoformat() == "2026-09-12"
    assert (
        await db_session.execute(
            select(Todo).where(Todo.title == "Check support terms")
        )
    ).scalar_one_or_none() is None

    applied, _job_id = await plan_proposal_service.apply_proposal(
        db_session,
        parent.id,
        PlanApplyRequest(
            proposal_id=proposal.id,
            base_graph_revision=proposal.base_graph_revision,
        ),
    )
    child = await db_session.get(Todo, applied.created_subtask_ids[0])
    assert child.parent_id == parent.id
    assert child.title == "Check support terms"
    child_id = child.id

    undone, _job_id = await plan_proposal_service.revert_change_set(
        db_session, applied.change_set_id
    )
    assert undone.reverted_subtask_ids == [child_id]
    assert await db_session.get(Todo, child_id) is None


async def test_discovered_work_is_previewed_as_sibling_and_does_not_change_run(
    orchestrator, db_session
):
    from models.agent_task import AgentTask
    from models.agent_run import AgentRun
    from services.planning import plan_proposal_service

    root, conversation = await _task_thread(db_session, as_project_root=False)
    branch = Todo(id=make_id("todo_"), title="Mobile", parent_id=root.id)
    db_session.add(branch)
    await db_session.flush()
    task = Todo(id=make_id("todo_"), title="Panel", parent_id=branch.id, status="in_progress")
    db_session.add(task)
    await db_session.flush()
    agent = AgentTask(id=make_id("agent_"), task_type="delegate_research", instruction="Original scope", todo_id=task.id)
    db_session.add(agent)
    await db_session.flush()
    run = AgentRun(id=make_id("run_"), agent_task_id=agent.id, attempt=1,
                   instruction_snapshot="Original scope", provider="builtin", status="waiting_input")
    db_session.add(run)
    conversation.metadata_json = json.dumps({"origin": "agent_run", "todo_id": task.id})
    await db_session.commit()
    _, metadata = await orchestrator.resolve_intent_response(
        db_session, conversation.id, "create_todo", {"title": "Preserve thread selection"}, "Add follow-up work",
    )
    assert metadata["discovered_from_task_id"] == task.id
    assert metadata["todo_id"] == branch.id
    assert (await db_session.execute(select(Todo).where(Todo.title == "Preserve thread selection"))).scalar_one_or_none() is None
    proposal = await db_session.get(PlanProposal, metadata["plan_proposal_id"])
    applied, _ = await plan_proposal_service.apply_proposal(db_session, branch.id, PlanApplyRequest(
        proposal_id=proposal.id, base_graph_revision=proposal.base_graph_revision,
    ))
    child_id = applied.created_subtask_ids[0]
    child = await db_session.get(Todo, child_id)
    assert child.parent_id == branch.id
    await db_session.refresh(run)
    assert run.status == "waiting_input"
    assert run.instruction_snapshot == "Original scope"
    await plan_proposal_service.revert_change_set(db_session, applied.change_set_id)
    assert await db_session.get(Todo, child_id) is None


async def test_plan_task_from_a_task_thread_starts_the_planner(
    orchestrator, db_session, monkeypatch
):
    import asyncio

    from services.planning import plan_proposal_service

    planned: list[tuple[str, str | None]] = []

    async def _generate(db, ai, todo_id, *, proposal_id=None):
        planned.append((todo_id, proposal_id))

    monkeypatch.setattr(plan_proposal_service, "generate_proposal", _generate)
    todo, conversation = await _task_thread(db_session, as_project_root=False)

    text, metadata = await orchestrator.resolve_intent_response(
        db_session, conversation.id, "plan_task", {}, "계획 세워줘"
    )
    await asyncio.sleep(0)

    assert planned == [(todo.id, metadata["plan_proposal_id"])]
    assert metadata["action_type"] == "plan_started"
    assert metadata["todo_id"] == todo.id
    assert metadata["plan_proposal_id"].startswith("proposal_")
    assert datetime.fromisoformat(metadata["plan_requested_at"]).tzinfo is not None
    assert "Compare vendors" in text


async def test_plan_task_without_a_target_asks_which(orchestrator, db_session):
    text, metadata = await _resolve(orchestrator, db_session, "plan_task", {})
    assert metadata is None
    assert "Which task" in text


async def _task_thread(db, *, as_project_root: bool):
    """A todo and a conversation scoped to it, optionally as a project root."""
    from models.conversation import Conversation
    from models.project import Project

    todo = Todo(id=make_id("todo_"), title="Compare vendors", status=TaskStatus.PENDING)
    db.add(todo)
    await db.flush()
    if as_project_root:
        db.add(
            Project(id=make_id("project_"), title="Procurement", root_task_id=todo.id)
        )
        await db.flush()
    conversation = Conversation(
        id=make_id("conv_"), title=todo.title, project_todo_id=todo.id
    )
    db.add(conversation)
    await db.commit()
    return todo, conversation


def _swallow_launch(monkeypatch):
    from services.agents import agent_run_service

    launched: list[str] = []

    def _record(run_id, coroutine):
        coroutine.close()
        launched.append(run_id)

    monkeypatch.setattr(agent_run_service, "launch_execution", _record)
    return launched


async def test_delegating_in_a_task_thread_runs_that_task(
    orchestrator, db_session, monkeypatch
):
    """Work delegated in a thread about a task is that task's run: visible on
    it in the tree, and its approval completes it."""
    from models.agent_run import AgentRun
    from models.agent_task import AgentTask

    launched = _swallow_launch(monkeypatch)
    todo, conversation = await _task_thread(db_session, as_project_root=False)

    text, metadata = await orchestrator.resolve_intent_response(
        db_session,
        conversation.id,
        "delegate_task",
        {"instruction": "Find three vendors"},
        "",
    )

    task = (await db_session.execute(select(AgentTask))).scalars().one()
    run = (await db_session.execute(select(AgentRun))).scalars().one()
    assert task.todo_id == todo.id
    assert task.conversation_id == conversation.id
    assert metadata["todo_id"] == todo.id
    assert launched == [run.id]
    await db_session.refresh(todo)
    assert todo.status == TaskStatus.IN_PROGRESS
    assert "Compare vendors" in text


async def test_delegating_in_a_project_chat_stays_free_standing(
    orchestrator, db_session, monkeypatch
):
    """A project's context chat is scoped to the root container; delegating
    there must not turn the whole project into one run."""
    from models.agent_task import AgentTask

    _swallow_launch(monkeypatch)
    todo, conversation = await _task_thread(db_session, as_project_root=True)

    _text, metadata = await orchestrator.resolve_intent_response(
        db_session,
        conversation.id,
        "delegate_task",
        {"instruction": "Summarize status"},
        "",
    )

    task = (await db_session.execute(select(AgentTask))).scalars().one()
    assert task.todo_id is None
    assert metadata["todo_id"] is None
    await db_session.refresh(todo)
    assert todo.status == TaskStatus.PENDING


async def test_delegating_twice_in_a_task_thread_points_at_the_active_run(
    orchestrator, db_session, monkeypatch
):
    from models.agent_run import AgentRun

    launched = _swallow_launch(monkeypatch)
    _todo, conversation = await _task_thread(db_session, as_project_root=False)
    await orchestrator.resolve_intent_response(
        db_session,
        conversation.id,
        "delegate_task",
        {"instruction": "Find vendors"},
        "",
    )
    first_run = (await db_session.execute(select(AgentRun))).scalars().one()

    text, metadata = await orchestrator.resolve_intent_response(
        db_session,
        conversation.id,
        "delegate_task",
        {"instruction": "Find more vendors"},
        "",
    )

    runs = (await db_session.execute(select(AgentRun))).scalars().all()
    assert [run.id for run in runs] == [first_run.id]
    assert launched == [first_run.id]
    assert metadata == {
        "action_type": "task_run_active",
        "todo_id": _todo.id,
        "run_id": first_run.id,
    }
    assert "already has a run in progress" in text


# --- a day is a deadline, a clock time is an appointment ------------------


async def test_a_dateless_time_becomes_a_task_deadline(orchestrator, db_session):
    # The classifier hands back midnight when the message only named a day.
    # Creating a midnight event would put an appointment nobody attends on the
    # calendar; this workspace treats that day as something to finish by.
    text, metadata = await _resolve(
        orchestrator,
        db_session,
        "create_event",
        {"title": "File the report", "start_time": "2026-09-05T00:00:00"},
    )

    todo = (
        await db_session.execute(select(Todo).where(Todo.title == "File the report"))
    ).scalar_one()
    assert todo.due_date.date() == datetime(2026, 9, 5).date()
    assert metadata["action_type"] == "todo_created"
    assert "File the report" in text

    events = (await db_session.execute(select(Event))).scalars().all()
    assert events == []


async def test_a_clock_time_still_creates_an_event(orchestrator, db_session):
    _text, metadata = await _resolve(
        orchestrator,
        db_session,
        "create_event",
        {"title": "Standup", "start_time": "2026-09-05T15:00:00"},
    )

    event = (
        await db_session.execute(select(Event).where(Event.title == "Standup"))
    ).scalar_one()
    assert event.start_time.hour == 15
    assert metadata["action_type"] == "event_created"


async def test_midnight_with_an_end_time_stays_an_event(orchestrator, db_session):
    # An explicit span is a real all-day booking, not a deadline.
    await _resolve(
        orchestrator,
        db_session,
        "create_event",
        {
            "title": "Company offsite",
            "start_time": "2026-09-05T00:00:00",
            "end_time": "2026-09-06T00:00:00",
        },
    )

    event = (
        await db_session.execute(select(Event).where(Event.title == "Company offsite"))
    ).scalar_one()
    assert event.end_time is not None
