from domain.task import TaskStatus
from models.todo import Todo
from services.tasks import todo_service


async def test_offline_capture_keeps_original_time_anchor(client, auth_headers):
    body = {"title": "금요일까지 논문", "inbox_state": "captured",
            "captured_at": "2026-09-02T10:00:00+09:00"}
    response = await client.post("/api/todos", headers=auth_headers, json=body)
    assert response.status_code == 201, response.text
    assert response.json()["created_at"].startswith("2026-09-02T01:00:00")


async def test_inbox_filter_is_applied_before_count_and_pagination(db_session):
    db_session.add_all([
        Todo(id="captured", title="Capture", inbox_state="captured"),
        Todo(id="ordinary", title="Task", inbox_state="none"),
        Todo(id="closed", title="Done", inbox_state="captured", status=TaskStatus.COMPLETED),
    ])
    await db_session.commit()
    rows, total = await todo_service.get_todos(
        db_session, inbox_state="captured", status_filter=TaskStatus.PENDING, limit=1,
    )
    assert total == 1
    assert [row.id for row in rows] == ["captured"]
    _, unfiltered = await todo_service.get_todos(db_session)
    assert unfiltered == 3


async def test_inbox_filter_is_exposed_by_api(client, auth_headers):
    for title, state in [("Capture", "captured"), ("Ordinary", "none")]:
        response = await client.post("/api/todos", headers=auth_headers, json={"title": title, "inbox_state": state})
        assert response.status_code == 201
    response = await client.get("/api/todos", headers=auth_headers, params={"inbox_state": "captured", "status": "pending"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "Capture"
