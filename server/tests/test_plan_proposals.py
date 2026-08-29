import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock

import pytest
from auth.dependencies import get_current_user
from config import settings
from database import Base, get_db
from domain.plan_proposal import (
    GLOBAL_TASK_GRAPH_SCOPE_ID,
    ChangeSetStatus,
    PlanProposalStatus,
    VaultSyncJobStatus,
)
from httpx import ASGITransport, AsyncClient
from main import app
from models.agent_task import AgentTask
from models.attachment import Attachment
from models.change_set import ChangeSet
from models.event import Event
from models.plan_proposal import PlanProposal
from models.task_graph_state import TaskGraphState
from models.todo import Todo
from models.vault_sync_job import VaultSyncJob
from schemas.task import PlanPayload
from services.planning import (
    plan_proposal_service,
    todo_planning_service,
)
from services.vault import (
    vault_sync_service,
)
from services.planning.todo_planning_service import ExternalPlanningContext
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


async def _create_root(db_session, *, title: str = "Root project") -> Todo:
    root = Todo(id="todo_root", title=title, inbox_state="none")
    db_session.add(root)
    await db_session.commit()
    return root


async def _create_proposal(
    db_session,
    root: Todo,
    payload: dict,
    *,
    proposal_id: str = "proposal_a",
) -> PlanProposal:
    state = await db_session.get(TaskGraphState, GLOBAL_TASK_GRAPH_SCOPE_ID)
    assert state is not None
    canonical = PlanPayload.model_validate(payload).model_dump(mode="json")
    task = AgentTask(
        id=f"task_{proposal_id}",
        task_type="plan_todo",
        agent_type="plan",
        instruction="Plan root",
        status="completed",
        todo_id=root.id,
        payload_json=json.dumps(canonical),
    )
    proposal = PlanProposal(
        id=proposal_id,
        root_task_id=root.id,
        agent_task_id=task.id,
        base_graph_revision=state.revision,
        payload_json=json.dumps(canonical),
        validation_json='{"errors": [], "warnings": []}',
        status=PlanProposalStatus.DRAFT,
    )
    root.inbox_state = "plan_ready"
    db_session.add_all([task, proposal])
    await db_session.commit()
    return proposal


def _apply_body(proposal: PlanProposal, **updates) -> dict:
    body = {
        "proposal_id": proposal.id,
        "base_graph_revision": proposal.base_graph_revision,
    }
    body.update(updates)
    return body


@pytest.mark.asyncio
async def test_apply_uses_exact_proposal_instead_of_latest(
    client, auth_headers, db_session
):
    root = await _create_root(db_session)
    proposal_a = await _create_proposal(
        db_session,
        root,
        {
            "summary": "A",
            "suggested_skills": ["research"],
            "subtasks": [{"title": "Task from A"}],
        },
        proposal_id="proposal_a",
    )
    proposal_b = await _create_proposal(
        db_session,
        root,
        {
            "summary": "B",
            "suggested_skills": ["draft"],
            "subtasks": [{"title": "Task from B"}],
        },
        proposal_id="proposal_b",
    )

    latest = await client.get(
        f"/api/todos/{root.id}/plan/latest",
        headers=auth_headers,
    )
    assert latest.status_code == 200
    assert latest.json()["proposal_id"] == proposal_b.id

    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal_a),
    )
    assert response.status_code == 200
    await db_session.refresh(root)
    assert root.assignee == "research"
    children = list(
        (await db_session.execute(select(Todo).where(Todo.parent_id == root.id)))
        .scalars()
        .all()
    )
    assert [child.title for child in children] == ["Task from A"]


@pytest.mark.asyncio
async def test_apply_infers_root_due_date_from_latest_selected_child(
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {
            "subtasks": [
                {"title": "Early", "due_date": "2026-09-02"},
                {"title": "Late", "due_date": "2026-09-09"},
            ]
        },
    )

    latest = await client.get(
        f"/api/todos/{root.id}/plan/latest",
        headers=auth_headers,
    )
    assert latest.status_code == 200
    assert "due_date" in latest.json()["diff"]["root_update_fields"]

    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    assert response.status_code == 200
    assert "due_date" in response.json()["root_update_fields"]
    await db_session.refresh(root)
    assert root.due_date is not None
    assert root.due_date.date().isoformat() == "2026-09-09"


@pytest.mark.asyncio
async def test_plan_diff_matches_actual_root_value_changes(
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    root.enabled_skills = '[ "research" ]'
    root.assignee = "research"
    root.due_date = datetime(2026, 9, 9, tzinfo=timezone.utc)
    root.source = "obsidian_project"
    root.source_id = "Existing_project"
    await db_session.commit()
    proposal = await _create_proposal(
        db_session,
        root,
        {
            "suggested_skills": ["research"],
            "suggested_root_due_date": "2026-09-09",
            "suggested_project_title": "Ignored because already linked",
            "subtasks": [{"title": "Child", "due_date": "2026-09-08"}],
        },
    )

    latest = await client.get(
        f"/api/todos/{root.id}/plan/latest",
        headers=auth_headers,
    )
    assert latest.status_code == 200
    assert latest.json()["diff"]["root_update_fields"] == []

    applied = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    assert applied.status_code == 200
    assert applied.json()["root_update_fields"] == []


@pytest.mark.asyncio
async def test_generation_becomes_stale_when_graph_changes_during_llm(
    client, auth_headers, db_session
):
    root = await _create_root(db_session)
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowAI:
        model = "slow-test-model"

        async def generate_completion(self, _system: str, _user: str) -> str:
            started.set()
            await release.wait()
            return json.dumps(
                {
                    "summary": "Plan",
                    "subtasks": [{"title": "Generated"}],
                }
            )

    previous_ai = getattr(app.state, "ai_service", None)
    previous_active = getattr(app.state, "active_ai", None)
    app.state.ai_service = SlowAI()
    app.state.active_ai = app.state.ai_service
    request_task = asyncio.create_task(
        client.post(
            f"/api/todos/{root.id}/plan/generate",
            headers=auth_headers,
            json={},
        )
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        root.description = "Concurrent graph edit"
        await db_session.commit()
        release.set()
        response = await request_task
    finally:
        release.set()
        if previous_ai is None:
            del app.state.ai_service
        else:
            app.state.ai_service = previous_ai
        if previous_active is None:
            del app.state.active_ai
        else:
            app.state.active_ai = previous_active

    assert response.status_code == 200
    assert response.json()["status"] == "stale"
    proposal = (await db_session.execute(select(PlanProposal))).scalar_one()
    assert proposal.status == PlanProposalStatus.STALE


@pytest.mark.asyncio
async def test_generation_becomes_stale_when_event_context_changes_during_llm(
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    event = Event(
        id="evt_planning_context",
        title="Original appointment",
        start_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(event)
    await db_session.commit()
    state = await db_session.get(TaskGraphState, GLOBAL_TASK_GRAPH_SCOPE_ID)
    assert state is not None
    base_revision = state.revision
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowAI:
        model = "slow-event-model"

        async def generate_completion(self, _system: str, _user: str) -> str:
            started.set()
            await release.wait()
            return json.dumps({"subtasks": [{"title": "Generated"}]})

    previous_ai = getattr(app.state, "ai_service", None)
    previous_active = getattr(app.state, "active_ai", None)
    app.state.ai_service = SlowAI()
    app.state.active_ai = app.state.ai_service
    request_task = asyncio.create_task(
        client.post(
            f"/api/todos/{root.id}/plan/generate",
            headers=auth_headers,
            json={},
        )
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        event.title = "Rescheduled appointment"
        await db_session.commit()
        await db_session.refresh(state)
        assert state.revision == base_revision
        release.set()
        response = await request_task
    finally:
        release.set()
        if previous_ai is None:
            del app.state.ai_service
        else:
            app.state.ai_service = previous_ai
        if previous_active is None:
            del app.state.active_ai
        else:
            app.state.active_ai = previous_active

    assert response.status_code == 200
    assert response.json()["status"] == "stale"
    assert {
        warning["code"] for warning in response.json()["validation"]["warnings"]
    } == {"planning_context_changed"}


@pytest.mark.asyncio
async def test_generation_becomes_stale_when_vault_context_changes_during_llm(
    monkeypatch,
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    root.source_id = "Project"
    await db_session.commit()
    external_version = {"todo_md": "before"}
    monkeypatch.setattr(
        todo_planning_service,
        "read_external_planning_context",
        lambda _context: ExternalPlanningContext(todo_md=external_version["todo_md"]),
    )
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowAI:
        model = "slow-vault-model"

        async def generate_completion(self, _system: str, _user: str) -> str:
            started.set()
            await release.wait()
            return json.dumps({"subtasks": [{"title": "Generated"}]})

    previous_ai = getattr(app.state, "ai_service", None)
    previous_active = getattr(app.state, "active_ai", None)
    app.state.ai_service = SlowAI()
    app.state.active_ai = app.state.ai_service
    request_task = asyncio.create_task(
        client.post(
            f"/api/todos/{root.id}/plan/generate",
            headers=auth_headers,
            json={},
        )
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        external_version["todo_md"] = "after"
        release.set()
        response = await request_task
    finally:
        release.set()
        if previous_ai is None:
            del app.state.ai_service
        else:
            app.state.ai_service = previous_ai
        if previous_active is None:
            del app.state.active_ai
        else:
            app.state.active_ai = previous_active

    assert response.status_code == 200
    assert response.json()["status"] == "stale"
    assert response.json()["validation"]["warnings"][0]["code"] == (
        "planning_context_changed"
    )


@pytest.mark.asyncio
async def test_generation_finalization_failure_is_durably_recorded(
    monkeypatch,
    db_session,
):
    root = await _create_root(db_session)

    class ValidAI:
        model = "finalization-failure-model"

        async def generate_completion(self, _system: str, _user: str) -> str:
            return json.dumps({"subtasks": [{"title": "Generated"}]})

    real_commit = db_session.commit
    commit_count = 0

    async def fail_finalization_commit_once():
        nonlocal commit_count
        commit_count += 1
        if commit_count == 2:
            raise RuntimeError("injected finalization commit failure")
        await real_commit()

    monkeypatch.setattr(db_session, "commit", fail_finalization_commit_once)
    with pytest.raises(RuntimeError, match="injected finalization commit failure"):
        await plan_proposal_service.generate_proposal(
            db_session,
            ValidAI(),
            root.id,
        )

    proposal = (await db_session.execute(select(PlanProposal))).scalar_one()
    agent_task = (await db_session.execute(select(AgentTask))).scalar_one()
    await db_session.refresh(root)
    assert commit_count == 3
    assert proposal.status == PlanProposalStatus.FAILED
    assert agent_task.status == "failed"
    assert root.inbox_state == "error"
    assert "finalization commit failure" in (agent_task.error or "")


@pytest.mark.asyncio
async def test_generation_commit_ack_failure_returns_durable_success(
    monkeypatch,
    db_session,
):
    root = await _create_root(db_session)

    class ValidAI:
        model = "ambiguous-commit-model"

        async def generate_completion(self, _system: str, _user: str) -> str:
            return json.dumps({"subtasks": [{"title": "Generated"}]})

    real_commit = db_session.commit
    commit_count = 0

    async def commit_then_lose_ack_once():
        nonlocal commit_count
        commit_count += 1
        await real_commit()
        if commit_count == 2:
            raise RuntimeError("commit acknowledgement was lost")

    monkeypatch.setattr(db_session, "commit", commit_then_lose_ack_once)
    response = await plan_proposal_service.generate_proposal(
        db_session,
        ValidAI(),
        root.id,
    )

    proposal = (await db_session.execute(select(PlanProposal))).scalar_one()
    agent_task = (await db_session.execute(select(AgentTask))).scalar_one()
    await db_session.refresh(root)
    assert commit_count == 2
    assert response.status == PlanProposalStatus.DRAFT
    assert proposal.status == PlanProposalStatus.DRAFT
    assert agent_task.status == "completed"
    assert root.inbox_state == "plan_ready"
    assert root.automation_error is None


@pytest.mark.asyncio
async def test_generation_finalizes_tracking_when_root_is_deleted_during_llm(
    client, auth_headers, db_session
):
    root = await _create_root(db_session)
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowAI:
        model = "slow-delete-model"

        async def generate_completion(self, _system: str, _user: str) -> str:
            started.set()
            await release.wait()
            return json.dumps({"subtasks": [{"title": "Generated"}]})

    previous_ai = getattr(app.state, "ai_service", None)
    previous_active = getattr(app.state, "active_ai", None)
    app.state.ai_service = SlowAI()
    app.state.active_ai = app.state.ai_service
    request_task = asyncio.create_task(
        client.post(
            f"/api/todos/{root.id}/plan/generate",
            headers=auth_headers,
            json={},
        )
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        await db_session.delete(root)
        await db_session.commit()
        release.set()
        response = await request_task
    finally:
        release.set()
        if previous_ai is None:
            del app.state.ai_service
        else:
            app.state.ai_service = previous_ai
        if previous_active is None:
            del app.state.active_ai
        else:
            app.state.active_ai = previous_active

    assert response.status_code == 404
    proposal = (await db_session.execute(select(PlanProposal))).scalar_one()
    agent_task = (await db_session.execute(select(AgentTask))).scalar_one()
    assert proposal.status == PlanProposalStatus.STALE
    assert proposal.root_task_id is None
    assert agent_task.status == "completed"
    assert agent_task.todo_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raw_response",
    [
        "not json",
        json.dumps({"subtasks": [{"title": "Bad", "priority": "critical"}]}),
        json.dumps({"subtasks": [{"title": "Bad", "due_date": "09/01/2026"}]}),
        json.dumps(
            {
                "subtasks": [
                    {"title": "A", "depends_on_indices": [1]},
                    {"title": "B", "depends_on_indices": [0]},
                ]
            }
        ),
    ],
)
async def test_generation_rejects_malformed_or_invalid_model_output(
    raw_response,
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    previous_ai = getattr(app.state, "ai_service", None)
    previous_active = getattr(app.state, "active_ai", None)
    fake_ai = type(
        "FakeAI",
        (),
        {
            "model": "invalid-test-model",
            "generate_completion": AsyncMock(return_value=raw_response),
        },
    )()
    app.state.ai_service = fake_ai
    app.state.active_ai = fake_ai
    try:
        response = await client.post(
            f"/api/todos/{root.id}/plan/generate",
            headers=auth_headers,
            json={},
        )
    finally:
        if previous_ai is None:
            del app.state.ai_service
        else:
            app.state.ai_service = previous_ai
        if previous_active is None:
            del app.state.active_ai
        else:
            app.state.active_ai = previous_active

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PLAN_GENERATION_FAILED"
    proposal = (await db_session.execute(select(PlanProposal))).scalar_one()
    assert proposal.status == PlanProposalStatus.FAILED
    await db_session.refresh(root)
    assert root.inbox_state == "error"


@pytest.mark.asyncio
async def test_apply_rejects_unselected_dependency(client, auth_headers, db_session):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {
            "subtasks": [
                {"title": "Prerequisite"},
                {"title": "Dependent", "depends_on_indices": [0]},
            ]
        },
    )
    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal, selected_indices=[1]),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PLAN_VALIDATION_ERROR"
    child_count = (
        await db_session.execute(
            select(func.count(Todo.id)).where(Todo.parent_id == root.id)
        )
    ).scalar_one()
    assert child_count == 0


@pytest.mark.asyncio
async def test_apply_rejects_edited_subtask_cardinality_change(
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Reviewed task"}]},
    )
    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(
            proposal,
            subtasks=[
                {"title": "Reviewed task"},
                {"title": "Unreviewed injected task"},
            ],
        ),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PLAN_VALIDATION_ERROR"
    assert response.json()["error"]["details"]["errors"][0]["code"] == (
        "subtask_cardinality_changed"
    )
    assert (
        await db_session.execute(select(func.count(ChangeSet.id)))
    ).scalar_one() == 0
    assert (
        await db_session.execute(
            select(func.count(Todo.id)).where(Todo.parent_id == root.id)
        )
    ).scalar_one() == 0
    await db_session.refresh(proposal)
    assert proposal.status == PlanProposalStatus.DRAFT


@pytest.mark.asyncio
async def test_stale_apply_writes_nothing(client, auth_headers, db_session):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Generated"}]},
    )
    root.description = "Edited after preview"
    await db_session.commit()

    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STALE_PLAN_PROPOSAL"
    assert (
        await db_session.execute(select(func.count(ChangeSet.id)))
    ).scalar_one() == 0
    assert (
        await db_session.execute(
            select(func.count(Todo.id)).where(Todo.parent_id == root.id)
        )
    ).scalar_one() == 0


@pytest.mark.asyncio
async def test_apply_replay_is_idempotent_and_different_edits_conflict(
    client, auth_headers, db_session
):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Generated"}]},
    )
    body = _apply_body(proposal)
    first = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=body,
    )
    second = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=body,
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["created_subtask_ids"] == second.json()["created_subtask_ids"]
    assert first.json()["change_set_id"] == second.json()["change_set_id"]
    assert second.json()["already_applied"] is True
    assert (
        await db_session.execute(select(func.count(ChangeSet.id)))
    ).scalar_one() == 1

    different = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(
            proposal,
            subtasks=[{"title": "Different approved title"}],
        ),
    )
    assert different.status_code == 409
    assert different.json()["error"]["code"] == "PLAN_PROPOSAL_CONFLICT"


@pytest.mark.asyncio
async def test_concurrent_apply_requests_create_exactly_one_change_set(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'concurrent-apply.db'}",
        pool_size=4,
        max_overflow=0,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as seed_db:
        root = await _create_root(seed_db)
        proposal = await _create_proposal(
            seed_db,
            root,
            {"subtasks": [{"title": "Generated once"}]},
        )
        body = _apply_body(proposal)

    async def override_db():
        async with session_factory() as session:
            yield session

    async def override_user() -> str:
        return "user"

    original_db_override = app.dependency_overrides.get(get_db)
    original_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as api:
            responses = await asyncio.gather(
                *(
                    api.post(
                        f"/api/todos/{root.id}/plan/apply",
                        json=body,
                    )
                    for _ in range(4)
                )
            )
        assert [response.status_code for response in responses] == [200] * 4
        change_set_ids = {response.json()["change_set_id"] for response in responses}
        child_ids = {
            tuple(response.json()["created_subtask_ids"]) for response in responses
        }
        assert len(change_set_ids) == len(child_ids) == 1
        assert (
            sum(not response.json()["already_applied"] for response in responses) == 1
        )
        async with session_factory() as verify_db:
            assert (
                await verify_db.execute(select(func.count(ChangeSet.id)))
            ).scalar_one() == 1
            assert (
                await verify_db.execute(
                    select(func.count(Todo.id)).where(Todo.parent_id == root.id)
                )
            ).scalar_one() == 1
    finally:
        if original_db_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = original_db_override
        if original_user_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = original_user_override
        await engine.dispose()


@pytest.mark.asyncio
async def test_apply_undo_and_undo_replay(client, auth_headers, db_session):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Generated"}]},
    )
    applied = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    assert applied.status_code == 200
    change_set_id = applied.json()["change_set_id"]

    first = await client.post(
        f"/api/change-sets/{change_set_id}/revert",
        headers=auth_headers,
    )
    second = await client.post(
        f"/api/change-sets/{change_set_id}/revert",
        headers=auth_headers,
    )
    assert first.status_code == second.status_code == 200
    assert second.json()["already_reverted"] is True
    assert first.json()["reverted_subtask_ids"] == applied.json()["created_subtask_ids"]
    assert (
        await db_session.execute(
            select(func.count(Todo.id)).where(Todo.parent_id == root.id)
        )
    ).scalar_one() == 0
    await db_session.refresh(root)
    assert root.inbox_state == "none"
    change_set = await db_session.get(ChangeSet, change_set_id)
    assert change_set is not None
    assert change_set.status == ChangeSetStatus.REVERTED


@pytest.mark.asyncio
async def test_undo_rejects_later_graph_edit(client, auth_headers, db_session):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Generated"}]},
    )
    applied = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    child = await db_session.get(Todo, applied.json()["created_subtask_ids"][0])
    assert child is not None
    child.title = "User edited"
    await db_session.commit()

    response = await client.post(
        f"/api/change-sets/{applied.json()['change_set_id']}/revert",
        headers=auth_headers,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STALE_PLAN_PROPOSAL"


@pytest.mark.asyncio
@pytest.mark.parametrize("reference_type", ["attachment", "agent_task"])
async def test_undo_rejects_non_graph_child_references(
    reference_type,
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Generated"}]},
    )
    applied = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    child_id = applied.json()["created_subtask_ids"][0]
    if reference_type == "attachment":
        db_session.add(
            Attachment(
                id="att_child",
                filename="result.txt",
                stored_filename="stored.txt",
                content_type="text/plain",
                size_bytes=1,
                todo_id=child_id,
            )
        )
    else:
        db_session.add(
            AgentTask(
                id="task_child_run",
                task_type="delegate_research",
                agent_type="research",
                instruction="Research",
                status="queued",
                todo_id=child_id,
            )
        )
    await db_session.commit()

    response = await client.post(
        f"/api/change-sets/{applied.json()['change_set_id']}/revert",
        headers=auth_headers,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PLAN_PROPOSAL_CONFLICT"
    assert await db_session.get(Todo, child_id) is not None


@pytest.mark.asyncio
async def test_apply_failure_rolls_back_all_graph_writes(
    monkeypatch,
    client,
    auth_headers,
    db_session,
):
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Generated"}]},
    )
    monkeypatch.setattr(
        plan_proposal_service.task_relationship_service,
        "replace_task_dependencies",
        AsyncMock(side_effect=RuntimeError("injected edge failure")),
    )

    with pytest.raises(RuntimeError, match="injected edge failure"):
        await client.post(
            f"/api/todos/{root.id}/plan/apply",
            headers=auth_headers,
            json=_apply_body(proposal),
        )
    assert (
        await db_session.execute(
            select(func.count(Todo.id)).where(Todo.parent_id == root.id)
        )
    ).scalar_one() == 0
    assert (
        await db_session.execute(select(func.count(ChangeSet.id)))
    ).scalar_one() == 0
    await db_session.refresh(proposal)
    assert proposal.status == PlanProposalStatus.DRAFT


@pytest.mark.asyncio
async def test_vault_io_is_post_commit_and_failed_job_can_retry(
    monkeypatch,
    tmp_path,
    client,
    auth_headers,
    db_session,
):
    monkeypatch.setattr(settings, "obsidian_vault_path", str(tmp_path))
    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {
            "suggested_project_title": "Safe project",
            "subtasks": [{"title": "Generated"}],
        },
    )
    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    assert response.status_code == 200
    assert list(tmp_path.iterdir()) == []
    job = (await db_session.execute(select(VaultSyncJob))).scalar_one()
    assert job.status == VaultSyncJobStatus.PENDING

    real_reconcile = vault_sync_service.reconcile_todos_in_vault
    monkeypatch.setattr(
        vault_sync_service,
        "reconcile_todos_in_vault",
        Mock(side_effect=RuntimeError("vault unavailable")),
    )
    failed = await vault_sync_service.process_vault_sync_job(db_session, job.id)
    assert failed == VaultSyncJobStatus.FAILED
    await db_session.refresh(job)
    assert job.last_error

    # Make the durable retry immediately eligible and restore the real handler.
    job.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()
    monkeypatch.setattr(
        vault_sync_service,
        "reconcile_todos_in_vault",
        real_reconcile,
    )
    succeeded = await vault_sync_service.process_vault_sync_job(db_session, job.id)
    assert succeeded == VaultSyncJobStatus.SUCCEEDED
    assert (tmp_path / "Safe_project" / "TODO.md").is_file()


@pytest.mark.asyncio
async def test_existing_vault_todo_file_is_never_truncated_by_plan_apply(
    monkeypatch,
    tmp_path,
    client,
    auth_headers,
    db_session,
):
    monkeypatch.setattr(settings, "obsidian_vault_path", str(tmp_path))
    project_dir = tmp_path / "Safe_project"
    project_dir.mkdir()
    todo_file = project_dir / "TODO.md"
    original = "# User project\n\nThis user-authored line must survive.\n"
    todo_file.write_text(original, encoding="utf-8")

    root = await _create_root(db_session)
    proposal = await _create_proposal(
        db_session,
        root,
        {
            "suggested_project_title": "Safe project",
            "subtasks": [{"title": "Generated"}],
        },
    )
    response = await client.post(
        f"/api/todos/{root.id}/plan/apply",
        headers=auth_headers,
        json=_apply_body(proposal),
    )
    assert response.status_code == 200
    assert todo_file.read_text(encoding="utf-8") == original

    job = (await db_session.execute(select(VaultSyncJob))).scalar_one()
    status = await vault_sync_service.process_vault_sync_job(db_session, job.id)
    assert status == VaultSyncJobStatus.SUCCEEDED
    content = todo_file.read_text(encoding="utf-8")
    assert "This user-authored line must survive." in content
    assert f"<!-- claw:{root.id} -->" in content
    for child_id in response.json()["created_subtask_ids"]:
        assert f"<!-- claw:{child_id} -->" in content


def test_plan_openapi_contract_is_versioned_and_named():
    schema = app.openapi()
    components = schema["components"]["schemas"]
    assert components["PlanProposalStatus"]["enum"] == [
        "generating",
        "draft",
        "applying",
        "applied",
        "rejected",
        "stale",
        "reverted",
        "failed",
    ]
    plan_properties = components["PlanResponse"]["properties"]
    assert plan_properties["status"] == {
        "$ref": "#/components/schemas/PlanProposalStatus"
    }
    assert plan_properties["diff"] == {"$ref": "#/components/schemas/PlanProposalDiff"}
    apply_request = components["PlanApplyRequest"]
    assert {"proposal_id", "base_graph_revision"}.issubset(apply_request["required"])
    apply_path = schema["paths"]["/api/todos/{todo_id}/plan/apply"]["post"]
    assert apply_path["responses"]["409"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }
    apply_422 = apply_path["responses"]["422"]["content"]["application/json"]["schema"]
    assert {option["$ref"] for option in apply_422["anyOf"]} == {
        "#/components/schemas/ErrorResponse",
        "#/components/schemas/RequestValidationErrorResponse",
    }
    generate_path = schema["paths"]["/api/todos/{todo_id}/plan/generate"]["post"]
    assert generate_path["responses"]["502"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/ErrorResponse"}
    assert "/api/change-sets/{change_set_id}/revert" in schema["paths"]
    assert schema["paths"]["/api/todos/{todo_id}/plan/dismiss"]["post"]["requestBody"]
