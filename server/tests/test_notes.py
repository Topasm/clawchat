from sqlalchemy import func, select

from models.note import Note
from models.project import Project
from models.todo import Todo


async def test_notes_require_authentication(client):
    assert (await client.get("/api/notes")).status_code == 401


async def test_capture_note_does_not_create_or_plan_a_task(
    client, auth_headers, db_session
):
    response = await client.post(
        "/api/notes",
        headers=auth_headers,
        json={
            "content": "  Meeting ideas\nKeep the second line.  ",
            "idempotency_key": "capture-1",
        },
    )
    assert response.status_code == 201
    note = response.json()
    assert note["content"] == "Meeting ideas\nKeep the second line."
    assert note["project_id"] is None
    assert await db_session.scalar(select(func.count()).select_from(Todo)) == 0
    assert (await client.get("/api/notes", headers=auth_headers)).json() == [note]


async def test_capture_retries_are_idempotent_and_key_conflicts_rejected(
    client, auth_headers
):
    body = {"content": "A note", "idempotency_key": "capture-1"}
    first = await client.post("/api/notes", headers=auth_headers, json=body)
    retry = await client.post("/api/notes", headers=auth_headers, json=body)
    assert retry.json()["id"] == first.json()["id"]
    conflict = await client.post(
        "/api/notes", headers=auth_headers, json={**body, "content": "Different"}
    )
    assert conflict.status_code == 409


async def test_move_between_projects_and_back_preserves_content(
    client, auth_headers, db_session
):
    db_session.add_all([Project(id="p1", title="One"), Project(id="p2", title="Two")])
    await db_session.commit()
    note = (
        await client.post(
            "/api/notes", headers=auth_headers, json={"content": "Reference\nFull text"}
        )
    ).json()
    for project in ("p1", "p2", None):
        moved = await client.patch(
            "/api/notes/" + note["id"],
            headers=auth_headers,
            json={"project_id": project},
        )
        assert moved.status_code == 200
        assert moved.json()["project_id"] == project
        assert moved.json()["content"] == note["content"]
    assert (
        await client.patch(
            "/api/notes/" + note["id"],
            headers=auth_headers,
            json={"project_id": "missing"},
        )
    ).status_code == 404
    await db_session.refresh(await db_session.get(Note, note["id"]))
    assert (await db_session.get(Note, note["id"])).project_id is None


async def test_edit_and_delete_note(client, auth_headers):
    note = (
        await client.post("/api/notes", headers=auth_headers, json={"content": "First"})
    ).json()
    path = "/api/notes/" + note["id"]
    assert (
        await client.patch(path, headers=auth_headers, json={"content": "Updated"})
    ).json()["content"] == "Updated"
    assert (
        await client.patch(path, headers=auth_headers, json={"content": None})
    ).status_code == 422
    assert (
        await client.post("/api/notes", headers=auth_headers, json={"content": "  "})
    ).status_code == 422
    assert (await client.delete(path, headers=auth_headers)).status_code == 204
    assert (await client.get("/api/notes", headers=auth_headers)).json() == []


async def test_deleting_project_returns_notes_to_inbox(db_session):
    project = Project(id="p1", title="One")
    db_session.add(project)
    await db_session.flush()
    note = Note(content="Keep me", project_id="p1")
    db_session.add(note)
    await db_session.commit()
    await db_session.delete(project)
    await db_session.commit()
    await db_session.refresh(note)
    assert note.project_id is None
    assert note.content == "Keep me"
