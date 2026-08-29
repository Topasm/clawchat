"""Attachment upload streaming, size enforcement, and partial-file cleanup."""

import os

import pytest

from config import settings as app_settings
from routers import attachment as attachment_router


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    target = tmp_path / "uploads"
    target.mkdir()
    monkeypatch.setattr(app_settings, "upload_dir", str(target))
    return target


class _FakeUpload:
    """Minimal UploadFile stand-in that records how much was actually read."""

    def __init__(self, payload: bytes):
        self._payload = payload
        self._pos = 0
        self.bytes_served = 0

    async def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = len(self._payload) - self._pos
        chunk = self._payload[self._pos:self._pos + size]
        self._pos += len(chunk)
        self.bytes_served += len(chunk)
        return chunk


@pytest.mark.asyncio
async def test_upload_stores_file_and_records_size(client, auth_headers, upload_dir):
    payload = b"hello vault" * 100
    response = await client.post(
        "/api/attachments",
        headers=auth_headers,
        files={"file": ("notes.txt", payload, "text/plain")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["filename"] == "notes.txt"
    assert body["size_bytes"] == len(payload)

    stored = upload_dir / body["stored_filename"]
    assert stored.read_bytes() == payload


@pytest.mark.asyncio
async def test_upload_larger_than_a_single_chunk_round_trips(
    client, auth_headers, upload_dir, monkeypatch
):
    """A payload spanning several chunks must be reassembled byte-for-byte."""
    monkeypatch.setattr(attachment_router, "UPLOAD_CHUNK_SIZE", 1024)
    payload = os.urandom(1024 * 5 + 17)

    response = await client.post(
        "/api/attachments",
        headers=auth_headers,
        files={"file": ("blob.zip", payload, "application/zip")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["size_bytes"] == len(payload)
    assert (upload_dir / body["stored_filename"]).read_bytes() == payload


@pytest.mark.asyncio
async def test_oversized_upload_is_rejected_and_leaves_no_partial_file(
    client, auth_headers, upload_dir, monkeypatch
):
    monkeypatch.setattr(app_settings, "max_upload_size_mb", 1)
    monkeypatch.setattr(attachment_router, "UPLOAD_CHUNK_SIZE", 64 * 1024)
    payload = b"x" * (1024 * 1024 + 4096)

    response = await client.post(
        "/api/attachments",
        headers=auth_headers,
        files={"file": ("big.txt", payload, "text/plain")},
    )

    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["message"] == "File exceeds maximum size of 1MB"
    # The partial write must be cleaned up, not orphaned on disk.
    assert list(upload_dir.iterdir()) == []


@pytest.mark.asyncio
async def test_oversized_upload_creates_no_db_row(client, auth_headers, upload_dir, monkeypatch):
    monkeypatch.setattr(app_settings, "max_upload_size_mb", 1)
    payload = b"y" * (1024 * 1024 + 1)

    reject = await client.post(
        "/api/attachments",
        headers=auth_headers,
        files={"file": ("big.txt", payload, "text/plain")},
    )
    assert reject.status_code == 400

    listing = await client.get("/api/attachments", headers=auth_headers)
    assert listing.status_code == 200
    assert listing.json() == []


@pytest.mark.asyncio
async def test_stream_helper_stops_reading_once_the_limit_is_crossed(tmp_path, monkeypatch):
    """The limit is enforced *during* the read, so the rest is never pulled in."""
    monkeypatch.setattr(attachment_router, "UPLOAD_CHUNK_SIZE", 1024)
    max_bytes = 4 * 1024
    upload = _FakeUpload(b"z" * (512 * 1024))
    path = tmp_path / "partial.bin"

    with pytest.raises(attachment_router._UploadTooLargeError):
        await attachment_router._stream_upload_to_disk(upload, str(path), max_bytes)

    # At most one chunk beyond the limit is ever read into memory.
    assert upload.bytes_served <= max_bytes + attachment_router.UPLOAD_CHUNK_SIZE
    # The aborted write is still on disk here; the router is what removes it.
    assert path.exists()
    attachment_router._discard_partial_file(str(path))
    assert not path.exists()


@pytest.mark.asyncio
async def test_discard_partial_file_ignores_missing_paths(tmp_path):
    attachment_router._discard_partial_file(str(tmp_path / "never-created.bin"))


@pytest.mark.asyncio
async def test_disallowed_extension_writes_nothing(client, auth_headers, upload_dir):
    response = await client.post(
        "/api/attachments",
        headers=auth_headers,
        files={"file": ("payload.exe", b"MZ", "application/octet-stream")},
    )

    assert response.status_code == 400
    assert list(upload_dir.iterdir()) == []
