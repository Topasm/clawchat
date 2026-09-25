from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from exceptions import ConflictError, NotFoundError
from models.note import Note
from models.project import Project
from schemas.note import NoteCreate, NoteResponse, NoteUpdate
from ws.notifications import notify_module_data_changed

router = APIRouter(dependencies=[Depends(get_current_user)])


async def require_project(db, project_id):
    if project_id is not None and await db.get(Project, project_id) is None:
        raise NotFoundError("Project not found")


async def require_note(db, note_id):
    note = await db.get(Note, note_id)
    if note is None:
        raise NotFoundError("Note not found")
    return note


@router.get("", response_model=list[NoteResponse])
async def list_notes(db: AsyncSession = Depends(get_db)):
    return (
        await db.scalars(select(Note).order_by(Note.updated_at.desc(), Note.id))
    ).all()


async def replay(db, body):
    if not body.idempotency_key:
        return None
    note = await db.scalar(
        select(Note).where(Note.idempotency_key == body.idempotency_key)
    )
    if note and (note.content != body.content or note.project_id != body.project_id):
        raise ConflictError("This capture key belongs to a different note")
    return note


@router.post("", response_model=NoteResponse, status_code=201)
async def create_note(body: NoteCreate, db: AsyncSession = Depends(get_db)):
    if existing := await replay(db, body):
        return existing
    await require_project(db, body.project_id)
    note = Note(**body.model_dump())
    db.add(note)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if existing := await replay(db, body):
            return existing
        raise
    await db.refresh(note)
    await notify_module_data_changed("notes")
    return note


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: str, body: NoteUpdate, db: AsyncSession = Depends(get_db)
):
    note = await require_note(db, note_id)
    changes = body.model_dump(exclude_unset=True)
    if "project_id" in changes:
        await require_project(db, body.project_id)
    for field, value in changes.items():
        setattr(note, field, value)
    await db.commit()
    await db.refresh(note)
    await notify_module_data_changed("notes")
    return note


@router.delete("/{note_id}", status_code=204)
async def delete_note(note_id: str, db: AsyncSession = Depends(get_db)):
    await db.delete(await require_note(db, note_id))
    await db.commit()
    await notify_module_data_changed("notes")
    return Response(status_code=204)
