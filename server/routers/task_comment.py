"""HTTP API for user-authored task comment threads."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from schemas.common import ErrorResponse
from schemas.task_comment import TaskCommentCreate, TaskCommentResponse
from services.tasks import task_comment_service
from ws.notifications import notify_module_data_changed

router = APIRouter()

_NOT_FOUND_RESPONSE = {
    404: {
        "model": ErrorResponse,
        "description": "Todo or task comment not found",
    }
}


@router.get("", response_model=list[TaskCommentResponse])
async def list_task_comments(
    todo_ids: str = Query(..., description="Comma-separated todo IDs"),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    ids = [todo_id.strip() for todo_id in todo_ids.split(",") if todo_id.strip()]
    return await task_comment_service.list_comments(db, ids)


@router.post(
    "",
    response_model=TaskCommentResponse,
    status_code=201,
    responses=_NOT_FOUND_RESPONSE,
)
async def create_task_comment(
    body: TaskCommentCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    comment = await task_comment_service.create_comment(db, body.todo_id, body.content)
    await db.commit()
    await db.refresh(comment)
    await notify_module_data_changed("todos")
    return comment


@router.delete(
    "/{comment_id}",
    status_code=204,
    responses=_NOT_FOUND_RESPONSE,
)
async def delete_task_comment(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    await task_comment_service.delete_comment(db, comment_id)
    await db.commit()
    await notify_module_data_changed("todos")
    return Response(status_code=204)
