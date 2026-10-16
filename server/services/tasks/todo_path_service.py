"""Paths attached to tasks, and the ones a step inherits from above it."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from exceptions import NotFoundError, ValidationError
from models.execution_host import ExecutionHost, ProjectHostPath
from models.todo import Todo
from models.todo_path import TodoPath
from schemas.task_step import TodoPathCreate, TodoPathResponse


async def _host_labels(db: AsyncSession, host_ids: set[str]) -> dict[str, str]:
    if not host_ids:
        return {}
    rows = await db.execute(
        select(ExecutionHost.id, ExecutionHost.label).where(ExecutionHost.id.in_(host_ids))
    )
    return dict(rows.all())


def _response(
    row: TodoPath, labels: dict[str, str], *, inherited: bool
) -> TodoPathResponse:
    return TodoPathResponse(
        id=row.id,
        todo_id=row.todo_id,
        kind=row.kind,  # type: ignore[arg-type]
        host_id=row.host_id,
        host_label=labels.get(row.host_id) if row.host_id else None,
        path=row.path,
        label=row.label,
        inherited=inherited,
        created_at=row.created_at,
    )


async def list_paths(db: AsyncSession, todo_id: str) -> list[TodoPathResponse]:
    """The task's own paths, then the nearest ancestor's, then the project's."""
    todo = await db.get(Todo, todo_id)
    if todo is None:
        raise NotFoundError(f"Todo {todo_id} not found")
    own = list(
        (
            await db.execute(
                select(TodoPath)
                .where(TodoPath.todo_id == todo_id)
                .order_by(TodoPath.created_at.asc(), TodoPath.id.asc())
            )
        ).scalars()
    )
    inherited: list[TodoPath] = []
    seen = {todo_id}
    cursor = todo
    while cursor.parent_id and cursor.parent_id not in seen and not inherited:
        seen.add(cursor.parent_id)
        parent = await db.get(Todo, cursor.parent_id)
        if parent is None:
            break
        inherited = list(
            (
                await db.execute(
                    select(TodoPath)
                    .where(TodoPath.todo_id == parent.id)
                    .order_by(TodoPath.created_at.asc(), TodoPath.id.asc())
                )
            ).scalars()
        )
        cursor = parent

    project_paths: list[ProjectHostPath] = []
    if not inherited and todo.project_id:
        project_paths = list(
            (
                await db.execute(
                    select(ProjectHostPath)
                    .where(ProjectHostPath.project_id == todo.project_id)
                    .order_by(ProjectHostPath.created_at.asc())
                )
            ).scalars()
        )

    labels = await _host_labels(
        db,
        {row.host_id for row in [*own, *inherited] if row.host_id}
        | {row.host_id for row in project_paths},
    )
    return [
        *(_response(row, labels, inherited=False) for row in own),
        *(_response(row, labels, inherited=True) for row in inherited),
        *(
            TodoPathResponse(
                id=row.id,
                todo_id=None,
                kind="device",
                host_id=row.host_id,
                host_label=labels.get(row.host_id),
                path=row.path,
                inherited=True,
            )
            for row in project_paths
        ),
    ]


async def add_path(
    db: AsyncSession, todo_id: str, body: TodoPathCreate
) -> TodoPathResponse:
    if await db.get(Todo, todo_id) is None:
        raise NotFoundError(f"Todo {todo_id} not found")
    host_id = body.host_id if body.kind == "device" else None
    if host_id is not None and await db.get(ExecutionHost, host_id) is None:
        raise ValidationError("Unknown machine", details={"host_id": host_id})
    row = TodoPath(
        todo_id=todo_id,
        kind=body.kind,
        host_id=host_id,
        path=body.path,
        label=body.label.strip() if body.label and body.label.strip() else None,
    )
    db.add(row)
    await db.flush()
    labels = await _host_labels(db, {host_id} if host_id else set())
    return _response(row, labels, inherited=False)


async def delete_path(db: AsyncSession, todo_id: str, path_id: str) -> None:
    row = await db.get(TodoPath, path_id)
    if row is None or row.todo_id != todo_id:
        raise NotFoundError(f"Path {path_id} not found")
    await db.delete(row)
    await db.flush()
