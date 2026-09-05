"""AI Inbox placement preview coverage."""

import json
from datetime import datetime, timezone

import pytest
from exceptions import AppError
from main import app
from models.todo import Todo
from services.planning import inbox_triage_service
from services.tasks import project_service, task_placement_service


def _tool_response(
    suggestions: list[dict], proposed_workstreams: list[dict] | None = None
) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {
                            "function": {
                                "arguments": json.dumps(
                                    {
                                        "suggestions": suggestions,
                                        "proposed_workstreams": proposed_workstreams
                                        or [],
                                    }
                                )
                            }
                        }
                    ]
                }
            }
        ]
    }


class FakeTriageAI:
    def __init__(
        self,
        suggestions: list[dict],
        proposed_workstreams: list[dict] | None = None,
    ):
        self.suggestions = suggestions
        self.proposed_workstreams = proposed_workstreams or []
        self.calls: list[dict] = []

    async def function_call(self, **kwargs) -> dict:
        self.calls.append(kwargs)
        return _tool_response(self.suggestions, self.proposed_workstreams)


@pytest.mark.asyncio
async def test_follow_up_context_contains_approved_branch_and_deadline_is_read_only(db_session):
    project = await project_service.create_project(db_session, title="논문 작성")
    branch = Todo(title="논문 준비", project_id=project.id, parent_id=project.root_task_id)
    draft = Todo(title="논문 초안", inbox_state="captured")
    db_session.add_all([branch, draft])
    await db_session.commit()
    await task_placement_service.place_task(db_session, todo_id=draft.id, project_id=project.id,
        parent_id=branch.id, before_id=None, inbox_state="none",
        expected_graph_revision=await task_placement_service.current_graph_revision(db_session))
    await db_session.commit()
    figure = Todo(title="금요일까지 논문 피규어 만들기", inbox_state="captured",
                  created_at=datetime(2026, 9, 2, tzinfo=timezone.utc))
    unrelated = Todo(title="우유 사기", inbox_state="captured")
    db_session.add_all([figure, unrelated])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    ai = FakeTriageAI([{"task_id": figure.id, "project_id": project.id,
        "parent_id": branch.id, "confidence": 0.9, "reason": "같은 논문 준비 작업"}])
    result = await inbox_triage_service.generate_preview(db_session, ai,
        todo_ids=[figure.id, unrelated.id], expected_graph_revision=revision,
        model_provider="test", timezone_name="Asia/Seoul")
    context = json.loads(ai.calls[0]["user_message"])
    assert context["recent_approved_placements"][0]["task_id"] == draft.id
    assert context["recent_approved_placements"][0]["parent_id"] == branch.id
    assert result.suggestions[0].parent_id == branch.id
    assert result.unassigned_task_ids == [unrelated.id]
    assert str(result.deadlines[0].local_date) == "2026-09-04"
    await db_session.refresh(figure)
    assert figure.project_id is None and figure.due_date is None
    assert await task_placement_service.current_graph_revision(db_session) == revision


@pytest.mark.asyncio
async def test_deadline_only_preview_without_projects_preserves_existing_dates(db_session):
    task = Todo(title="금요일까지 논문", inbox_state="captured")
    db_session.add(task)
    await db_session.commit()
    ai = FakeTriageAI([])
    revision = await task_placement_service.current_graph_revision(db_session)
    result = await inbox_triage_service.generate_preview(db_session, ai, todo_ids=[task.id],
        expected_graph_revision=revision, model_provider="test")
    assert len(result.deadlines) == 1
    assert result.unassigned_task_ids == [task.id]
    assert ai.calls == []
    task.due_date = datetime(2026, 10, 1, tzinfo=timezone.utc)
    await db_session.commit()
    result = await inbox_triage_service.generate_preview(db_session, ai, todo_ids=[task.id],
        expected_graph_revision=await task_placement_service.current_graph_revision(db_session), model_provider="test")
    assert result.deadlines == []


@pytest.mark.asyncio
async def test_generate_preview_returns_valid_suggestions_and_unassigned(db_session):
    project = await project_service.create_project(db_session, title="Research")
    parent = Todo(title="Experiments", project_id=project.id)
    first = Todo(title="Run ablation", inbox_state="captured")
    second = Todo(title="Buy groceries", inbox_state="captured")
    db_session.add_all([parent, first, second])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    ai = FakeTriageAI(
        [
            {
                "task_id": first.id,
                "project_id": project.id,
                "parent_id": parent.id,
                "confidence": 0.91,
                "reason": "This is an experiment task.",
            }
        ]
    )

    result = await inbox_triage_service.generate_preview(
        db_session,
        ai,
        todo_ids=[first.id, second.id],
        expected_graph_revision=revision,
        model_provider="test",
    )

    assert result.base_graph_revision == revision
    assert result.suggestions[0].parent_id == parent.id
    assert result.unassigned_task_ids == [second.id]
    assert result.model_provider == "test"
    assert json.loads(ai.calls[0]["user_message"])["inbox_tasks"][0]["id"] == first.id
    assert await task_placement_service.current_graph_revision(db_session) == revision
    await db_session.refresh(first)
    assert first.project_id is None


@pytest.mark.asyncio
async def test_preview_endpoint_rejects_parent_from_another_project(
    client, auth_headers, db_session
):
    first_project = await project_service.create_project(db_session, title="First")
    second_project = await project_service.create_project(db_session, title="Second")
    wrong_parent = Todo(title="Wrong parent", project_id=second_project.id)
    inbox = Todo(title="Place me", inbox_state="captured")
    db_session.add_all([wrong_parent, inbox])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    fake = FakeTriageAI(
        [
            {
                "task_id": inbox.id,
                "project_id": first_project.id,
                "parent_id": wrong_parent.id,
                "confidence": 0.8,
                "reason": "Invalid cross-project parent.",
            }
        ]
    )
    previous = getattr(app.state, "active_ai", None)
    app.state.active_ai = fake
    try:
        response = await client.post(
            "/api/todos/placements/triage-preview",
            headers=auth_headers,
            json={
                "todo_ids": [inbox.id],
                "expected_graph_revision": revision,
            },
        )
    finally:
        app.state.active_ai = previous

    assert response.status_code == 502, response.text
    assert response.json()["error"]["code"] == "INBOX_TRIAGE_GENERATION_FAILED"


@pytest.mark.asyncio
async def test_generate_preview_can_propose_a_new_workstream(db_session):
    project = await project_service.create_project(db_session, title="Research")
    first = Todo(title="Check conference format", inbox_state="captured")
    second = Todo(title="Confirm submission deadline", inbox_state="captured")
    db_session.add_all([first, second])
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    proposal = {
        "key": "submission",
        "project_id": project.id,
        "parent_id": None,
        "title": "Submission",
        "description": "Conference submission preparation",
        "confidence": 0.88,
        "reason": "Both tasks prepare the submission.",
    }
    ai = FakeTriageAI(
        [
            {
                "task_id": todo.id,
                "project_id": project.id,
                "parent_id": None,
                "proposed_parent_key": "submission",
                "confidence": 0.9,
                "reason": "This belongs in submission preparation.",
            }
            for todo in (first, second)
        ],
        [proposal],
    )

    result = await inbox_triage_service.generate_preview(
        db_session,
        ai,
        todo_ids=[first.id, second.id],
        expected_graph_revision=revision,
        model_provider="test",
    )

    assert result.proposed_workstreams[0].title == "Submission"
    assert {item.proposed_parent_key for item in result.suggestions} == {"submission"}
    assert await task_placement_service.current_graph_revision(db_session) == revision


@pytest.mark.asyncio
async def test_preview_rejects_unused_workstream_proposal(db_session):
    project = await project_service.create_project(db_session, title="Research")
    inbox = Todo(title="Unrelated task", inbox_state="captured")
    db_session.add(inbox)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    ai = FakeTriageAI(
        [],
        [
            {
                "key": "unused",
                "project_id": project.id,
                "parent_id": None,
                "title": "Unused Workstream",
                "description": None,
                "confidence": 0.5,
                "reason": "Not referenced by a task.",
            }
        ],
    )

    with pytest.raises(AppError) as exc_info:
        await inbox_triage_service.generate_preview(
            db_session,
            ai,
            todo_ids=[inbox.id],
            expected_graph_revision=revision,
            model_provider="test",
        )
    assert "unused Workstream proposal" in exc_info.value.message


@pytest.mark.asyncio
async def test_stale_preview_is_rejected_before_calling_ai(
    client, auth_headers, db_session
):
    await project_service.create_project(db_session, title="Project")
    inbox = Todo(title="Place me", inbox_state="captured")
    db_session.add(inbox)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    fake = FakeTriageAI([])
    previous = getattr(app.state, "active_ai", None)
    app.state.active_ai = fake
    try:
        response = await client.post(
            "/api/todos/placements/triage-preview",
            headers=auth_headers,
            json={
                "todo_ids": [inbox.id],
                "expected_graph_revision": revision - 1,
            },
        )
    finally:
        app.state.active_ai = previous

    assert response.status_code == 409, response.text
    assert fake.calls == []
    openapi = (await client.get("/openapi.json")).json()
    assert "/api/todos/placements/triage-preview" in openapi["paths"]
