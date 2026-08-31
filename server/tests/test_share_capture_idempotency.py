"""Durable mobile share retries must never create duplicate records."""

import uuid

import pytest

from config import settings as app_settings


@pytest.fixture
def share_upload_dir(tmp_path, monkeypatch):
    target = tmp_path / "share-uploads"
    target.mkdir()
    monkeypatch.setattr(app_settings, "upload_dir", str(target))
    return target


@pytest.mark.asyncio
async def test_retried_share_capture_returns_the_original_todo(client, auth_headers):
    capture_id = str(uuid.uuid4())
    first = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "Shared article",
            "source": "share_sheet",
            "idempotency_key": capture_id,
        },
    )
    retry = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "A changed retry body must not create another task",
            "source": "share_sheet",
            "idempotency_key": capture_id,
        },
    )

    assert first.status_code == 201, first.text
    assert retry.status_code == 201, retry.text
    assert retry.json()["id"] == first.json()["id"]
    assert retry.json()["title"] == "Shared article"

    listing = await client.get("/api/todos", headers=auth_headers)
    matching = [
        item for item in listing.json()["items"]
        if item["id"] == first.json()["id"]
    ]
    assert len(matching) == 1


@pytest.mark.asyncio
async def test_share_capture_rejects_a_non_uuid_idempotency_key(client, auth_headers):
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Invalid", "idempotency_key": "not-a-uuid"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_retried_attachment_upload_reuses_the_original_file(
    client,
    auth_headers,
    share_upload_dir,
):
    capture_id = str(uuid.uuid4())
    todo = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "With attachment", "idempotency_key": capture_id},
    )
    assert todo.status_code == 201
    attachment_key = str(uuid.uuid5(uuid.UUID(capture_id), "attachment-0"))
    params = {
        "todo_id": todo.json()["id"],
        "idempotency_key": attachment_key,
    }

    first = await client.post(
        "/api/attachments",
        headers=auth_headers,
        params=params,
        files={"file": ("notes.txt", b"first body", "text/plain")},
    )
    retry = await client.post(
        "/api/attachments",
        headers=auth_headers,
        params=params,
        files={"file": ("notes.txt", b"retry body", "text/plain")},
    )

    assert first.status_code == 201, first.text
    assert retry.status_code == 201, retry.text
    assert retry.json()["id"] == first.json()["id"]
    assert len(list(share_upload_dir.iterdir())) == 1
    stored = share_upload_dir / first.json()["stored_filename"]
    assert stored.read_bytes() == b"first body"


@pytest.mark.asyncio
async def test_attachment_rejects_a_non_uuid_idempotency_key(
    client,
    auth_headers,
    share_upload_dir,
):
    response = await client.post(
        "/api/attachments",
        headers=auth_headers,
        params={"idempotency_key": "not-a-uuid"},
        files={"file": ("notes.txt", b"body", "text/plain")},
    )

    assert response.status_code == 400
    assert list(share_upload_dir.iterdir()) == []


@pytest.mark.asyncio
async def test_attachment_idempotency_key_cannot_cross_tasks(
    client,
    auth_headers,
    share_upload_dir,
):
    first_todo = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "First task"},
    )
    second_todo = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Second task"},
    )
    assert first_todo.status_code == 201
    assert second_todo.status_code == 201
    attachment_key = str(uuid.uuid4())

    first = await client.post(
        "/api/attachments",
        headers=auth_headers,
        params={
            "todo_id": first_todo.json()["id"],
            "idempotency_key": attachment_key,
        },
        files={"file": ("notes.txt", b"first body", "text/plain")},
    )
    conflict = await client.post(
        "/api/attachments",
        headers=auth_headers,
        params={
            "todo_id": second_todo.json()["id"],
            "idempotency_key": attachment_key,
        },
        files={"file": ("notes.txt", b"second body", "text/plain")},
    )

    assert first.status_code == 201, first.text
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["error"]["code"] == "CONFLICT"
    assert len(list(share_upload_dir.iterdir())) == 1
