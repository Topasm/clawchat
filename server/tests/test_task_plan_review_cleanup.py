"""A plan review leaves the queue once its task is done, deleted or a note."""

from domain.plan_proposal import PlanProposalStatus
from domain.review import ReviewStatus, ReviewSubjectType
from models.plan_proposal import PlanProposal
from models.review_item import ReviewItem
from models.todo import Todo
from sqlalchemy import select


async def _task_with_plan_review(db_session, *, title: str = "목요일 까지 영어 쓰기 과제") -> str:
    todo = Todo(title=title, inbox_state="plan_ready")
    db_session.add(todo)
    await db_session.flush()
    proposal = PlanProposal(root_task_id=todo.id, status=PlanProposalStatus.DRAFT)
    db_session.add(proposal)
    await db_session.flush()
    db_session.add(
        ReviewItem(
            subject_type=ReviewSubjectType.PLAN_PROPOSAL,
            subject_id=proposal.id,
            summary="Plan",
        )
    )
    await db_session.commit()
    return todo.id


async def _pending_titles(client, auth_headers) -> list[str | None]:
    response = await client.get("/api/reviews", headers=auth_headers)
    assert response.status_code == 200, response.text
    return [item["subject_title"] for item in response.json()]


async def _review_states(db_session) -> list[str]:
    db_session.expire_all()
    rows = (await db_session.execute(select(ReviewItem.status))).scalars().all()
    return list(rows)


async def test_the_review_card_is_titled_with_the_task(client, auth_headers, db_session):
    await _task_with_plan_review(db_session)
    response = await client.get("/api/reviews", headers=auth_headers)
    [card] = response.json()
    assert card["subject_title"] == "목요일 까지 영어 쓰기 과제"
    # No English sentence for the client to show verbatim.
    assert card["subject_description"] is None


async def test_completing_a_task_closes_its_plan_review(client, auth_headers, db_session):
    todo_id = await _task_with_plan_review(db_session)
    response = await client.patch(
        f"/api/todos/{todo_id}", headers=auth_headers, json={"status": "completed"}
    )
    assert response.status_code == 200, response.text
    assert await _pending_titles(client, auth_headers) == []
    assert await _review_states(db_session) == [ReviewStatus.EXPIRED]


async def test_bulk_completing_tasks_closes_their_plan_reviews(client, auth_headers, db_session):
    todo_id = await _task_with_plan_review(db_session)
    response = await client.patch(
        "/api/todos/bulk", headers=auth_headers, json={"ids": [todo_id], "status": "completed"}
    )
    assert response.status_code == 200, response.text
    assert await _pending_titles(client, auth_headers) == []


async def test_deleting_a_task_closes_its_plan_review(client, auth_headers, db_session):
    todo_id = await _task_with_plan_review(db_session)
    response = await client.delete(f"/api/todos/{todo_id}", headers=auth_headers)
    assert response.status_code in (200, 204), response.text
    assert await _pending_titles(client, auth_headers) == []


async def test_turning_a_task_into_a_note_closes_its_plan_review(
    client, auth_headers, db_session
):
    todo_id = await _task_with_plan_review(db_session, title="Lam 신호로 active vision gru 학습")
    response = await client.post(f"/api/todos/{todo_id}/to-note", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert await _pending_titles(client, auth_headers) == []


async def test_an_open_task_keeps_its_plan_review(client, auth_headers, db_session):
    todo_id = await _task_with_plan_review(db_session)
    response = await client.patch(
        f"/api/todos/{todo_id}", headers=auth_headers, json={"title": "Renamed"}
    )
    assert response.status_code == 200, response.text
    assert await _pending_titles(client, auth_headers) == ["Renamed"]
