import asyncio
import contextlib
import os
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from config import settings as app_settings
from database import get_db
from exceptions import ConflictError, NotFoundError, ValidationError
from models.attachment import Attachment
from schemas.attachment import AttachmentResponse
from utils import make_id

router = APIRouter()

_ALLOWED_EXTENSIONS: set[str] | None = None

# Uploads are streamed to disk in chunks so a single request never holds the
# whole file in memory and never blocks the event loop on a large write.
UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1 MiB


class _UploadTooLargeError(Exception):
    """Raised mid-stream once an upload crosses the configured size limit."""


def _discard_partial_file(path: str) -> None:
    """Best-effort removal of a partially written upload.

    Deliberately synchronous: a single ``unlink`` is cheap, and the cleanup
    paths below include cancellation, where awaiting anything would re-raise
    ``CancelledError`` before the file could be removed.
    """
    with contextlib.suppress(OSError):
        os.remove(path)


async def _stream_upload_to_disk(file: UploadFile, path: str, max_bytes: int) -> int:
    """Copy ``file`` to ``path`` in chunks, aborting as soon as the limit is hit.

    Disk writes are pushed onto a worker thread so concurrent SSE chat streams
    and WebSocket traffic keep making progress. Returns the byte count written.
    """
    total = 0
    handle = await asyncio.to_thread(open, path, "wb")
    try:
        while True:
            chunk = await file.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                # Stop reading immediately: the rest of the body is never
                # pulled into memory and the partial file is dropped by the
                # caller's cleanup.
                raise _UploadTooLargeError()
            await asyncio.to_thread(handle.write, chunk)
    finally:
        # Sync close: it only flushes a small buffer, and it still runs when
        # the request is cancelled (an ``await`` here would not).
        handle.close()
    return total


def _get_allowed_extensions() -> set[str]:
    global _ALLOWED_EXTENSIONS
    if _ALLOWED_EXTENSIONS is None:
        _ALLOWED_EXTENSIONS = {
            ext.strip().lower() for ext in app_settings.allowed_extensions.split(",") if ext.strip()
        }
    return _ALLOWED_EXTENSIONS


def _to_response(att: Attachment) -> AttachmentResponse:
    return AttachmentResponse(
        id=att.id,
        filename=att.filename,
        stored_filename=att.stored_filename,
        content_type=att.content_type,
        size_bytes=att.size_bytes,
        todo_id=att.todo_id,
        url=f"/api/attachments/{att.id}/download",
        created_at=att.created_at,
    )


def _require_same_idempotency_owner(
    attachment: Attachment,
    todo_id: str | None,
) -> None:
    if attachment.todo_id != todo_id:
        raise ConflictError(
            "Attachment idempotency key is already owned by another task"
        )


@router.post("", response_model=AttachmentResponse, status_code=201)
async def upload_attachment(
    file: UploadFile = File(...),
    todo_id: str | None = Query(None),
    idempotency_key: str | None = Query(None, max_length=64),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    if idempotency_key is not None:
        try:
            idempotency_key = str(UUID(idempotency_key))
        except ValueError as error:
            raise ValidationError("Invalid attachment idempotency key") from error
        existing = (
            await db.execute(
                select(Attachment).where(
                    Attachment.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            _require_same_idempotency_owner(existing, todo_id)
            return _to_response(existing)

    if not file.filename:
        raise ValidationError("No filename provided")

    # Validate extension
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in _get_allowed_extensions():
        raise ValidationError(f"File type '.{ext}' is not allowed")

    # Stream to disk, enforcing the size limit while reading rather than after
    max_bytes = app_settings.max_upload_size_mb * 1024 * 1024
    stored_filename = f"{uuid.uuid4().hex}.{ext}"
    file_path = os.path.join(app_settings.upload_dir, stored_filename)

    try:
        size_bytes = await _stream_upload_to_disk(file, file_path, max_bytes)
    except _UploadTooLargeError:
        _discard_partial_file(file_path)
        raise ValidationError(
            f"File exceeds maximum size of {app_settings.max_upload_size_mb}MB"
        )
    except BaseException:
        _discard_partial_file(file_path)
        raise

    # Create DB record
    attachment = Attachment(
        id=make_id("att_"),
        filename=file.filename,
        stored_filename=stored_filename,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        todo_id=todo_id,
        idempotency_key=idempotency_key,
    )
    db.add(attachment)
    try:
        await db.commit()
    except IntegrityError:
        _discard_partial_file(file_path)
        await db.rollback()
        if idempotency_key is None:
            raise
        existing = (
            await db.execute(
                select(Attachment).where(
                    Attachment.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        _require_same_idempotency_owner(existing, todo_id)
        return _to_response(existing)
    except BaseException:
        # Never leave a file on disk that no row points at.
        _discard_partial_file(file_path)
        raise
    await db.refresh(attachment)

    return _to_response(attachment)


@router.get("", response_model=list[AttachmentResponse])
async def list_attachments(
    todo_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    q = select(Attachment).order_by(Attachment.created_at.desc())
    if todo_id:
        q = q.where(Attachment.todo_id == todo_id)
    rows = (await db.execute(q)).scalars().all()
    return [_to_response(att) for att in rows]


@router.get("/{attachment_id}/download")
async def download_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    attachment = await db.get(Attachment, attachment_id)
    if not attachment:
        raise NotFoundError("Attachment not found")

    file_path = os.path.join(app_settings.upload_dir, attachment.stored_filename)
    if not os.path.exists(file_path):
        raise NotFoundError("Attachment file not found on disk")

    return FileResponse(
        path=file_path,
        filename=attachment.filename,
        media_type=attachment.content_type,
    )


@router.delete("/{attachment_id}", status_code=204)
async def delete_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    attachment = await db.get(Attachment, attachment_id)
    if not attachment:
        raise NotFoundError("Attachment not found")

    # Remove file from disk
    file_path = os.path.join(app_settings.upload_dir, attachment.stored_filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    await db.delete(attachment)
    await db.commit()
