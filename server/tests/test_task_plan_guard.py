"""Plan edits must not silently change the structure of an active run."""

import pytest
from sqlalchemy import select

from exceptions import AppError
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.todo import Todo
from models.task_relationship import TaskRelationship
from schemas.task_relationship import TaskRelationshipCreate
from schemas.task_relationship import TaskRelationshipUpdate
from services.tasks import task_relationship_service, todo_service
from services.tasks.task_plan_guard_service import require_editable_plan
from services.planning import plan_proposal_service
from schemas.task import PlanApplyRequest


async def active_task(db, status):
    db.add_all(
        [
            Todo(id="parent", title="Parent"),
            Todo(id="task", title="Task"),
            Todo(id="other", title="Other"),
        ]
    )
    await db.flush()
    db.add(
        AgentTask(
            id="agent",
            task_type="delegate_research",
            instruction="Work",
            todo_id="task",
        )
    )
    await db.flush()
    db.add(
        AgentRun(
            id="run",
            agent_task_id="agent",
            attempt=1,
            instruction_snapshot="Work",
            provider="builtin",
            status=status,
        )
    )
    await db.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status", ["queued", "starting", "running", "waiting_input", "waiting_review"]
)
async def test_active_run_blocks_new_prerequisite_and_child(db_session, status):
    await active_task(db_session, status)
    with pytest.raises(AppError) as error:
        await task_relationship_service.create_relationship(
            db_session,
            TaskRelationshipCreate(
                source_task_id="task",
                target_task_id="other",
                type="depends_on",
            ),
        )
    assert error.value.code == "TASK_PLAN_ACTIVE_RUN"
    assert error.value.details["run_id"] == "run"
    with pytest.raises(AppError):
        await todo_service.create_todo(db_session, title="Child", parent_id="task")
    assert (await db_session.execute(select(TaskRelationship))).scalars().all() == []
    assert (
        await db_session.execute(select(Todo).where(Todo.parent_id == "task"))
    ).scalars().all() == []
    # Another branch and a no-op dependency update remain editable.
    await require_editable_plan(db_session, ["other"])
    await task_relationship_service.replace_task_dependencies(db_session, "task", [])


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
async def test_terminal_run_allows_plan_edit(db_session, status):
    await active_task(db_session, status)
    await task_relationship_service.create_relationship(
        db_session,
        TaskRelationshipCreate(
            source_task_id="task",
            target_task_id="other",
            type="depends_on",
        ),
    )
    assert (
        len((await db_session.execute(select(TaskRelationship))).scalars().all()) == 1
    )


@pytest.mark.asyncio
async def test_proposal_preview_and_apply_recheck_live_execution(db_session):
    await active_task(db_session, "completed")
    preview = await plan_proposal_service.create_add_task_proposal(
        db_session,
        "task",
        title="New child",
    )
    assert not preview.validation.errors
    run = await db_session.get(AgentRun, "run")
    run.status = "running"
    await db_session.commit()
    proposal = await plan_proposal_service.get_proposal(
        db_session, "task", preview.proposal_id
    )
    blocked = await plan_proposal_service.build_plan_response(db_session, proposal)
    assert blocked.validation.errors[0].code == "TASK_PLAN_ACTIVE_RUN"
    with pytest.raises(AppError) as error:
        await plan_proposal_service.apply_proposal(
            db_session,
            "task",
            PlanApplyRequest(
                proposal_id=preview.proposal_id,
                base_graph_revision=preview.base_graph_revision,
            ),
        )
    assert error.value.code == "TASK_PLAN_ACTIVE_RUN"
    assert (
        await db_session.execute(select(Todo).where(Todo.parent_id == "task"))
    ).scalars().all() == []


@pytest.mark.asyncio
async def test_existing_dependency_cannot_be_removed_or_retyped_during_run(db_session):
    await active_task(db_session, "completed")
    edge = await task_relationship_service.create_relationship(
        db_session,
        TaskRelationshipCreate(
            source_task_id="task",
            target_task_id="other",
            type="depends_on",
        ),
    )
    edge_id = edge.id
    run = await db_session.get(AgentRun, "run")
    run.status = "waiting_review"
    await db_session.commit()
    with pytest.raises(AppError):
        await task_relationship_service.delete_relationship(db_session, edge_id)
    with pytest.raises(AppError):
        await task_relationship_service.update_relationship(
            db_session,
            edge_id,
            TaskRelationshipUpdate(type="related"),
        )


@pytest.mark.asyncio
async def test_moving_parent_of_running_task_is_blocked(db_session):
    await active_task(db_session, "running")
    task = await db_session.get(Todo, "task")
    task.parent_id = "parent"
    await db_session.commit()
    with pytest.raises(AppError) as error:
        await todo_service.update_todo(db_session, "parent", parent_id="other")
    assert error.value.code == "TASK_PLAN_ACTIVE_RUN"
    parent = await db_session.get(Todo, "parent")
    assert parent.parent_id is None
    from services.tasks.graph_command_service import current_graph_revision
    from services.tasks.task_placement_service import place_tasks

    revision = await current_graph_revision(db_session)
    with pytest.raises(AppError) as placement_error:
        await place_tasks(
            db_session,
            todo_ids=["parent"],
            project_id=None,
            parent_id="other",
            before_id=None,
            inbox_state=None,
            expected_graph_revision=revision,
        )
    assert placement_error.value.code == "TASK_PLAN_ACTIVE_RUN"
    await db_session.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "updates",
    [
        {"status": "completed"},
        {"status": "cancelled"},
        {"status": "pending"},
        {"title": "Changed goal"},
        {"description": "New instructions"},
    ],
)
async def test_live_task_cannot_bypass_run_lifecycle(db_session, updates):
    await active_task(db_session, "waiting_review")
    task = await db_session.get(Todo, "task")
    task.status = "in_progress"
    await db_session.commit()
    with pytest.raises(AppError) as error:
        await todo_service.update_todo(db_session, "task", **updates)
    assert error.value.code == "TASK_PLAN_ACTIVE_RUN"
    assert task.status == "in_progress"
    assert task.title == "Task"
    await todo_service.update_todo(db_session, "task", title="Task", priority="high")
    assert task.priority == "high"


@pytest.mark.asyncio
async def test_cannot_delete_running_task_or_its_prerequisite(db_session):
    await active_task(db_session, "running")
    db_session.add(
        TaskRelationship(
            source_task_id="task", target_task_id="other", type="depends_on"
        )
    )
    await db_session.commit()
    for task_id in ("task", "other"):
        with pytest.raises(AppError):
            await todo_service.delete_todo(db_session, task_id)
        assert await db_session.get(Todo, task_id) is not None
