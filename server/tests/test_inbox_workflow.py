"""HTTP workflow checks. Fake AI isolates orchestration from model quality."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import select, func

from main import app
from models.todo import Todo
from models.inbox_review import InboxPreviewCache
from services.tasks import project_service, task_placement_service
from tests.test_inbox_triage import FakeTriageAI


@pytest.mark.asyncio
@pytest.mark.parametrize("device_zone", ["Asia/Seoul", "America/Los_Angeles"])
async def test_capture_preview_defer_restore_approve_follow_up_and_undo(
    client, auth_headers, db_session, device_zone
):
    project = await project_service.create_project(db_session, title="논문 작성")
    branch = Todo(
        title="논문 준비", project_id=project.id, parent_id=project.root_task_id
    )
    db_session.add(branch)
    await db_session.commit()
    body = {
        "title": "금요일까지 논문 초안 작성",
        "inbox_state": "captured",
        "source": "android_inbox",
        "captured_at": "2026-09-02T10:00:00+09:00",
        "idempotency_key": str(uuid4()),
    }
    captured = await client.post("/api/todos", headers=auth_headers, json=body)
    assert captured.status_code == 201, captured.text
    task_id = captured.json()["id"]
    retried = await client.post("/api/todos", headers=auth_headers, json=body)
    assert retried.json()["id"] == task_id
    revision = await task_placement_service.current_graph_revision(db_session)
    ai = FakeTriageAI(
        [
            {
                "task_id": task_id,
                "project_id": project.id,
                "parent_id": branch.id,
                "confidence": 0.9,
                "reason": "논문 준비",
            }
        ]
    )
    old_ai = getattr(app.state, "active_ai", None)
    app.state.active_ai = ai
    try:
        request = {
            "todo_ids": [task_id],
            "expected_graph_revision": revision,
            "timezone": device_zone,
        }
        preview = await client.post(
            "/api/todos/placements/triage-preview", headers=auth_headers, json=request
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["deadlines"][0]["local_date"] == "2026-09-04"
        untouched = await client.get(f"/api/todos/{task_id}", headers=auth_headers)
        assert (
            untouched.json()["project_id"] is None
            and untouched.json()["due_date"] is None
        )
        deferred = await client.patch(
            f"/api/todos/{task_id}/inbox-review",
            headers=auth_headers,
            json={"deferred": True},
        )
        assert deferred.status_code == 204
        restored = await client.get(
            "/api/todos/placements/review-state", headers=auth_headers
        )
        assert restored.json()["items"][0]["deferred"]
        again = await client.post(
            "/api/todos/placements/triage-preview", headers=auth_headers, json=request
        )
        assert again.json() == preview.json() and len(ai.calls) == 1
        await client.post("/api/todos/placements/resume-deferred", headers=auth_headers)
        placement = {
            "project_id": project.id,
            "parent_id": branch.id,
            "inbox_state": "none",
            "expected_graph_revision": revision,
            "due_date": preview.json()["deadlines"][0]["due_date"],
        }
        applied = await client.post(
            f"/api/todos/{task_id}/placement", headers=auth_headers, json=placement
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["todo"]["parent_id"] == branch.id
        assert applied.json()["todo"]["due_date"] == "2026-09-04T23:59:59"
        assert (
            await client.get("/api/todos/placements/review-state", headers=auth_headers)
        ).json()["items"] == []
        duplicate = await client.post(
            f"/api/todos/{task_id}/placement", headers=auth_headers, json=placement
        )
        assert duplicate.status_code == 409
        immediate_undo = await client.post(
            f"/api/todos/placements/{applied.json()['change_set_id']}/undo",
            headers=auth_headers,
        )
        assert immediate_undo.status_code == 200, immediate_undo.text
        assert immediate_undo.json()["todo"]["due_date"] is None
        assert immediate_undo.json()["todo"]["inbox_state"] == "captured"
        placement["expected_graph_revision"] = immediate_undo.json()["graph_revision"]
        applied = await client.post(
            f"/api/todos/{task_id}/placement", headers=auth_headers, json=placement
        )
        assert applied.status_code == 200, applied.text
        follow_up = await client.post(
            "/api/todos",
            headers=auth_headers,
            json={"title": "논문 피규어 만들기", "inbox_state": "captured"},
        )
        next_id = follow_up.json()["id"]
        ai.suggestions = [
            {
                "task_id": next_id,
                "project_id": project.id,
                "parent_id": branch.id,
                "confidence": 0.9,
                "reason": "같은 논문",
            }
        ]
        next_revision = await task_placement_service.current_graph_revision(db_session)
        next_preview = await client.post(
            "/api/todos/placements/triage-preview",
            headers=auth_headers,
            json={
                "todo_ids": [next_id],
                "expected_graph_revision": next_revision,
                "timezone": device_zone,
            },
        )
        assert next_preview.status_code == 200, next_preview.text
        context = json.loads(ai.calls[-1]["user_message"])
        assert context["recent_approved_placements"][0]["task_id"] == task_id
        assert next_preview.json()["suggestions"][0]["parent_id"] == branch.id
        # New work changed the graph: old undo must not silently cross that boundary.
        undo = await client.post(
            f"/api/todos/placements/{applied.json()['change_set_id']}/undo",
            headers=auth_headers,
        )
        assert undo.status_code == 409
        assert (
            await db_session.execute(
                select(func.count())
                .select_from(Todo)
                .where(Todo.title == body["title"])
            )
        ).scalar() == 1
    finally:
        app.state.active_ai = old_ai


@pytest.mark.asyncio
async def test_project_context_changed_during_generation_is_not_cached(
    client, auth_headers, db_session
):
    project = await project_service.create_project(db_session, title="Paper")
    task = Todo(title="Figures", inbox_state="captured")
    db_session.add(task)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)

    class ChangingAI(FakeTriageAI):
        async def function_call(self, **kwargs):
            project.goal = "Changed research direction"
            await db_session.commit()
            return await super().function_call(**kwargs)

    old_ai = getattr(app.state, "active_ai", None)
    app.state.active_ai = ChangingAI([])
    try:
        result = await client.post(
            "/api/todos/placements/triage-preview",
            headers=auth_headers,
            json={"todo_ids": [task.id], "expected_graph_revision": revision},
        )
        assert result.status_code == 409, result.text
        assert (
            await db_session.execute(
                select(func.count()).select_from(InboxPreviewCache)
            )
        ).scalar() == 0
    finally:
        app.state.active_ai = old_ai
