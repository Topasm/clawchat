import json
from unittest.mock import AsyncMock

import pytest
from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID, PlanProposalStatus
from main import app
from models.agent_task import AgentTask
from models.plan_proposal import PlanProposal
from models.task_graph_state import TaskGraphState
from models.task_relationship import TaskRelationship
from models.todo import Todo
from schemas.task import PlanPayload
from sqlalchemy import select


async def _create_proposal(
    db_session,
    root: Todo,
    payload: dict,
    *,
    proposal_id: str = "proposal_plan",
) -> PlanProposal:
    state = await db_session.get(TaskGraphState, GLOBAL_TASK_GRAPH_SCOPE_ID)
    assert state is not None
    agent_task = AgentTask(
        id=f"task_{proposal_id}",
        task_type="plan_todo",
        agent_type="plan",
        instruction="Plan",
        status="completed",
        todo_id=root.id,
        payload_json=json.dumps(payload),
    )
    proposal = PlanProposal(
        id=proposal_id,
        root_task_id=root.id,
        agent_task_id=agent_task.id,
        base_graph_revision=state.revision,
        payload_json=json.dumps(
            PlanPayload.model_validate(payload).model_dump(mode="json")
        ),
        validation_json='{"errors": [], "warnings": []}',
        status=PlanProposalStatus.DRAFT,
    )
    db_session.add_all([agent_task, proposal])
    root.inbox_state = "plan_ready"
    await db_session.commit()
    return proposal


@pytest.mark.asyncio
async def test_apply_plan_respects_selection_edits_and_dependencies(
    client, auth_headers, db_session
):
    root = Todo(id="todo_root", title="Launch project", inbox_state="plan_ready")
    db_session.add(root)
    await db_session.commit()
    plan = await _create_proposal(
        db_session,
        root,
        {
            "summary": "Three-stage launch",
            "subtasks": [
                {"title": "Research", "depends_on_indices": []},
                {"title": "Draft", "depends_on_indices": []},
                {"title": "Review", "depends_on_indices": [1]},
            ],
        },
    )

    response = await client.post(
        "/api/todos/todo_root/plan/apply",
        headers=auth_headers,
        json={
            "proposal_id": plan.id,
            "base_graph_revision": plan.base_graph_revision,
            "selected_indices": [1, 2],
            "subtasks": [
                {"title": "Research", "depends_on_indices": []},
                {
                    "title": "Write first draft",
                    "priority": "high",
                    "due_date": "2026-09-01",
                    "depends_on_indices": [],
                },
                {"title": "Review", "depends_on_indices": [1]},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["created_subtask_ids"]) == 2
    assert payload["created_relationships"] == 1

    children = list((await db_session.execute(
        select(Todo).where(Todo.parent_id == root.id).order_by(Todo.sort_order)
    )).scalars().all())
    assert [child.title for child in children] == ["Write first draft", "Review"]
    assert children[0].priority == "high"
    assert children[0].due_date.date().isoformat() == "2026-09-01"
    assert children[0].depends_on is None
    assert json.loads(children[1].depends_on) == [children[0].id]
    relationships = list(
        (
            await db_session.execute(
                select(TaskRelationship).where(
                    TaskRelationship.source_task_id == children[1].id
                )
            )
        ).scalars().all()
    )
    assert len(relationships) == 1
    assert relationships[0].target_task_id == children[0].id
    assert relationships[0].type == "depends_on"
    assert relationships[0].created_by == "ai"
    assert relationships[0].proposal_id == plan.id
    assert payload["proposal_id"] == plan.id
    assert payload["change_set_id"].startswith("changeset_")
    assert payload["already_applied"] is False


@pytest.mark.asyncio
async def test_apply_plan_rejects_invalid_selection(client, auth_headers, db_session):
    root = Todo(id="todo_root", title="Project", inbox_state="plan_ready")
    db_session.add(root)
    await db_session.commit()
    plan = await _create_proposal(
        db_session,
        root,
        {"subtasks": [{"title": "Only task"}]},
    )

    response = await client.post(
        "/api/todos/todo_root/plan/apply",
        headers=auth_headers,
        json={
            "proposal_id": plan.id,
            "base_graph_revision": plan.base_graph_revision,
            "selected_indices": [3],
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_generate_plan_returns_preview_without_creating_children(
    client, auth_headers, db_session
):
    root = Todo(id="todo_root", title="New service", description="Build an MVP")
    db_session.add(root)
    await db_session.commit()

    previous_ai = getattr(app.state, "ai_service", None)
    app.state.ai_service = type("FakeAI", (), {
        "generate_completion": AsyncMock(return_value=json.dumps({
            "summary": "MVP delivery plan",
            "suggested_root_due_date": None,
            "suggested_skills": ["plan"],
            "suggested_project_title": None,
            "subtasks": [
                {
                    "title": "Define scope",
                    "priority": "high",
                    "estimated_minutes": 45,
                    "due_date": None,
                    "depends_on_indices": [],
                },
                {
                    "title": "Build prototype",
                    "priority": "medium",
                    "estimated_minutes": 180,
                    "due_date": None,
                    "depends_on_indices": [0],
                },
            ],
        }))
    })()
    try:
        response = await client.post(
            "/api/todos/todo_root/plan/generate",
            headers=auth_headers,
            json={"instructions": "Keep it to two concrete stages"},
        )
    finally:
        if previous_ai is None:
            del app.state.ai_service
        else:
            app.state.ai_service = previous_ai

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == "MVP delivery plan"
    assert [subtask["title"] for subtask in payload["subtasks"]] == [
        "Define scope",
        "Build prototype",
    ]

    children = list((await db_session.execute(
        select(Todo).where(Todo.parent_id == root.id)
    )).scalars().all())
    assert children == []
    await db_session.refresh(root)
    assert root.inbox_state == "plan_ready"
