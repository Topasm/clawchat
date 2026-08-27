import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from main import app
from models.agent_task import AgentTask
from models.todo import Todo


@pytest.mark.asyncio
async def test_apply_plan_respects_selection_edits_and_dependencies(
    client, auth_headers, db_session
):
    root = Todo(id="todo_root", title="Launch project", inbox_state="plan_ready")
    plan = AgentTask(
        id="task_plan",
        task_type="plan_todo",
        agent_type="plan",
        instruction="Plan launch",
        status="completed",
        todo_id=root.id,
        payload_json=json.dumps({
            "summary": "Three-stage launch",
            "subtasks": [
                {"title": "Research", "depends_on_indices": []},
                {"title": "Draft", "depends_on_indices": [0]},
                {"title": "Review", "depends_on_indices": [1]},
            ],
        }),
        completed_at=datetime.now(timezone.utc),
    )
    db_session.add_all([root, plan])
    await db_session.commit()

    response = await client.post(
        "/api/todos/todo_root/plan/apply",
        headers=auth_headers,
        json={
            "selected_indices": [1, 2],
            "subtasks": [
                {"title": "Research", "depends_on_indices": []},
                {
                    "title": "Write first draft",
                    "priority": "high",
                    "due_date": "2026-09-01",
                    "depends_on_indices": [0],
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
    assert children[0].depends_on is None  # excluded Research dependency is dropped
    assert json.loads(children[1].depends_on) == [children[0].id]


@pytest.mark.asyncio
async def test_apply_plan_rejects_invalid_selection(client, auth_headers, db_session):
    root = Todo(id="todo_root", title="Project", inbox_state="plan_ready")
    plan = AgentTask(
        id="task_plan",
        task_type="plan_todo",
        agent_type="plan",
        instruction="Plan",
        status="completed",
        todo_id=root.id,
        payload_json=json.dumps({"subtasks": [{"title": "Only task"}]}),
    )
    db_session.add_all([root, plan])
    await db_session.commit()

    response = await client.post(
        "/api/todos/todo_root/plan/apply",
        headers=auth_headers,
        json={"selected_indices": [3]},
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
