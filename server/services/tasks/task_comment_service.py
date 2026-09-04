"""Validation and persistence for user-authored task comment threads."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from exceptions import NotFoundError
from models.task_comment import TaskComment
from models.todo import Todo

_DEFAULT_PER_TODO_LIMIT = 5


async def _require_todo(db: AsyncSession, todo_id: str) -> None:
    exists = (
        await db.execute(select(Todo.id).where(Todo.id == todo_id).limit(1))
    ).scalar_one_or_none()
    if exists is None:
        raise NotFoundError(f"Todo {todo_id} not found")


async def create_comment(
    db: AsyncSession,
    todo_id: str,
    content: str,
    *,
    created_by: str = "user",
) -> TaskComment:
    await _require_todo(db, todo_id)
    comment = TaskComment(todo_id=todo_id, content=content, created_by=created_by)
    db.add(comment)
    await db.flush()
    return comment


async def list_comments(
    db: AsyncSession,
    todo_ids: list[str],
    *,
    per_todo_limit: int = _DEFAULT_PER_TODO_LIMIT,
) -> list[TaskComment]:
    """Return the most recent comments for each of ``todo_ids``.

    Comments for a given todo come back oldest-first (chat reading order);
    when a todo has more than ``per_todo_limit`` comments, only the most
    recent ones are included. Fetches every requested todo's thread in one
    round trip so callers (e.g. the mobile Now tab) avoid N+1 requests.
    """
    if not todo_ids:
        return []

    rows = (
        await db.execute(
            select(TaskComment)
            .where(TaskComment.todo_id.in_(todo_ids))
            .order_by(
                TaskComment.todo_id.asc(),
                TaskComment.created_at.desc(),
                TaskComment.id.desc(),
            )
        )
    ).scalars().all()

    kept_by_todo: dict[str, list[TaskComment]] = {}
    for comment in rows:
        bucket = kept_by_todo.setdefault(comment.todo_id, [])
        if len(bucket) < per_todo_limit:
            bucket.append(comment)

    ordered: list[TaskComment] = []
    for bucket in kept_by_todo.values():
        ordered.extend(reversed(bucket))
    ordered.sort(key=lambda comment: (comment.todo_id, comment.created_at, comment.id))
    return ordered


async def delete_comment(db: AsyncSession, comment_id: str) -> None:
    comment = await db.get(TaskComment, comment_id)
    if comment is None:
        raise NotFoundError(f"Task comment {comment_id} not found")
    await db.delete(comment)
    await db.flush()
