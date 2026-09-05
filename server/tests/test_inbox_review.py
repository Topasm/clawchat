import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from database import Base

from main import app
from models.todo import Todo
from models.inbox_review import InboxPreviewCache
from schemas.inbox_triage import InboxTriagePreviewResponse
from schemas.inbox_review import InboxReviewUpdate
from services.planning import inbox_review_service
from services.tasks import task_placement_service, project_service
from tests.test_inbox_triage import FakeTriageAI


@pytest.mark.asyncio
async def test_disk_state_survives_database_engine_restart(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'inbox.db'}"
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine)() as db:
        db.add(Todo(id="capture", title="Paper", inbox_state="captured"))
        await db.commit()
        await inbox_review_service.save_preference(db, "user", "capture", InboxReviewUpdate(deferred=True))
        preview = InboxTriagePreviewResponse(base_graph_revision=await task_placement_service.current_graph_revision(db),
            suggestions=[], unassigned_task_ids=["capture"])
        await inbox_review_service.store_preview(db, "user", "saved", preview)
        await db.commit()
    await engine.dispose()
    engine = create_async_engine(url)
    try:
        async with async_sessionmaker(engine)() as db:
            assert (await inbox_review_service.read_state(db, "user")).items[0].deferred
            assert (await inbox_review_service.load_preview(db, "user", "saved")).unassigned_task_ids == ["capture"]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_cached_results_are_account_scoped_and_bounded(db_session):
    preview = InboxTriagePreviewResponse(base_graph_revision=0, suggestions=[], unassigned_task_ids=[])
    for index in range(12):
        await inbox_review_service.store_preview(db_session, "a", str(index), preview)
    await db_session.commit()
    assert (await db_session.execute(select(func.count()).select_from(InboxPreviewCache))).scalar() == 8
    assert await inbox_review_service.load_preview(db_session, "b", "11") is None
    assert await inbox_review_service.load_preview(db_session, "a", "11") is not None


@pytest.mark.asyncio
async def test_preview_survives_new_request_and_ai_unavailability(
    client, auth_headers, db_session
):
    project = await project_service.create_project(db_session, title="Paper")
    task = Todo(title="금요일까지 논문", inbox_state="captured")
    db_session.add(task)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    ai = FakeTriageAI(
        [
            {
                "task_id": task.id,
                "project_id": project.id,
                "parent_id": None,
                "confidence": 0.9,
                "reason": "Paper",
            }
        ]
    )
    previous = getattr(app.state, "active_ai", None)
    body = {
        "todo_ids": [task.id],
        "expected_graph_revision": revision,
        "timezone": "Asia/Seoul",
    }
    try:
        app.state.active_ai = ai
        first = await client.post(
            "/api/todos/placements/triage-preview", headers=auth_headers, json=body
        )
        assert first.status_code == 200, first.text
        app.state.active_ai = None
        second = await client.post(
            "/api/todos/placements/triage-preview", headers=auth_headers, json=body
        )
        assert second.status_code == 200, second.text
        assert second.json() == first.json()
        assert len(ai.calls) == 1
        # Even content changes outside graph revision must not reuse old content.
        task.description = "Changed paper direction"
        await db_session.commit()
        app.state.active_ai = ai
        body[
            "expected_graph_revision"
        ] = await task_placement_service.current_graph_revision(db_session)
        third = await client.post(
            "/api/todos/placements/triage-preview", headers=auth_headers, json=body
        )
        assert third.status_code == 200, third.text
        assert len(ai.calls) == 2
        wrong_revision = {
            **body,
            "expected_graph_revision": body["expected_graph_revision"] + 100,
        }
        stale = await client.post(
            "/api/todos/placements/triage-preview",
            headers=auth_headers,
            json=wrong_revision,
        )
        assert stale.status_code == 409
    finally:
        app.state.active_ai = previous


@pytest.mark.asyncio
async def test_preferences_survive_requests_and_partial_updates(
    client, auth_headers, db_session
):
    task = Todo(title="Paper", inbox_state="captured")
    db_session.add(task)
    await db_session.commit()
    revision = await task_placement_service.current_graph_revision(db_session)
    path = f"/api/todos/{task.id}/inbox-review"
    for body in [
        {"deferred": True},
        {"exclude_deadline": True},
        {
            "choice": {"project_id": None, "parent_id": None},
            "expected_graph_revision": revision,
        },
    ]:
        response = await client.patch(path, headers=auth_headers, json=body)
        assert response.status_code == 204, response.text
    result = (
        await client.get("/api/todos/placements/review-state", headers=auth_headers)
    ).json()["items"][0]
    assert result["deferred"] and result["exclude_deadline"]
    assert result["choice"] == {"project_id": None, "parent_id": None}
    assert await task_placement_service.current_graph_revision(db_session) == revision
    resumed = await client.post(
        "/api/todos/placements/resume-deferred", headers=auth_headers
    )
    assert resumed.status_code == 204
    result = (
        await client.get("/api/todos/placements/review-state", headers=auth_headers)
    ).json()["items"][0]
    assert not result["deferred"] and result["exclude_deadline"]


@pytest.mark.asyncio
async def test_preferences_are_isolated_and_completed_tasks_are_not_restored(
    db_session,
):
    task = Todo(title="Paper", inbox_state="captured")
    db_session.add(task)
    await db_session.commit()
    await inbox_review_service.save_preference(
        db_session, "a", task.id, InboxReviewUpdate(deferred=True)
    )
    await db_session.commit()
    assert (await inbox_review_service.read_state(db_session, "b")).items == []
    assert len((await inbox_review_service.read_state(db_session, "a")).items) == 1
    task.inbox_state = "none"
    await db_session.commit()
    assert (await inbox_review_service.read_state(db_session, "a")).items == []
