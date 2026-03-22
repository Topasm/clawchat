import json
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database import get_db
from exceptions import NotFoundError
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.task_relationship import TaskRelationship
from models.todo import Todo
from schemas.bulk import BulkTodoResponse, BulkTodoUpdate
from schemas.common import PaginatedResponse
from schemas.task import DelegateRequest, PlanApplyResponse, PlanResponse
from schemas.todo import ProjectTodoResponse, TodoCreate, TodoResponse, TodoUpdate
from services import inbox_pipeline_service
from utils import apply_model_updates, deserialize_tags, make_id, serialize_tags
from config import settings
from services.obsidian_export_service import export_todo, remove_todo_from_vault

router = APIRouter()

_ORDER_COLUMNS = {
    "created_at": Todo.created_at,
    "updated_at": Todo.updated_at,
    "sort_order": Todo.sort_order,
    "priority": Todo.priority,
}


@router.get("/projects", response_model=list[ProjectTodoResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """List root todos (projects) with their conversation IDs and subtask counts."""
    q = (
        select(Todo)
        .where(Todo.parent_id.is_(None))
        .order_by(Todo.updated_at.desc())
    )
    projects = (await db.execute(q)).scalars().all()

    items = []
    for project in projects:
        # Get associated conversation
        conv_q = select(Conversation.id).where(
            Conversation.project_todo_id == project.id,
            Conversation.is_archived == False,  # noqa: E712
        ).limit(1)
        conv_id = (await db.execute(conv_q)).scalar()

        # Count subtasks
        subtask_q = select(func.count(Todo.id)).where(Todo.parent_id == project.id)
        subtask_count = (await db.execute(subtask_q)).scalar() or 0

        completed_q = select(func.count(Todo.id)).where(
            Todo.parent_id == project.id,
            Todo.status == "completed",
        )
        completed_count = (await db.execute(completed_q)).scalar() or 0

        resp = ProjectTodoResponse(
            id=project.id,
            title=project.title,
            description=project.description,
            status=project.status,
            priority=project.priority,
            due_date=project.due_date,
            completed_at=project.completed_at,
            tags=deserialize_tags(project.tags) if project.tags else None,
            parent_id=project.parent_id,
            sort_order=project.sort_order,
            source=project.source,
            source_id=project.source_id,
            assignee=project.assignee,
            created_at=project.created_at,
            updated_at=project.updated_at,
            conversation_id=conv_id,
            subtask_count=subtask_count,
            completed_subtask_count=completed_count,
        )
        items.append(resp)

    return items


@router.get("", response_model=PaginatedResponse[TodoResponse])
async def list_todos(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=1000),
    status: str | None = None,
    priority: str | None = None,
    due_before: datetime | None = None,
    parent_id: str | None = None,
    root_only: bool = False,
    order_by: str = "created_at",
    order_dir: str = "desc",
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    offset = (page - 1) * limit
    conditions = []
    if status:
        conditions.append(Todo.status == status)
    if priority:
        conditions.append(Todo.priority == priority)
    if due_before:
        conditions.append(Todo.due_date <= due_before)
    if parent_id:
        conditions.append(Todo.parent_id == parent_id)
    if root_only:
        conditions.append(Todo.parent_id.is_(None))

    count_q = select(func.count(Todo.id)).where(*conditions)
    total = (await db.execute(count_q)).scalar() or 0

    col = _ORDER_COLUMNS.get(order_by, Todo.created_at)
    order_clause = col.asc() if order_dir == "asc" else col.desc()

    q = (
        select(Todo)
        .where(*conditions)
        .order_by(order_clause)
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()

    items = []
    for row in rows:
        resp = TodoResponse.model_validate(row)
        if row.tags:
            resp.tags = deserialize_tags(row.tags)
        items.append(resp)

    return PaginatedResponse(items=items, total=total, page=page, limit=limit)


@router.patch("/bulk", response_model=BulkTodoResponse)
async def bulk_update_todos(
    body: BulkTodoUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    updated = 0
    deleted = 0
    deleted_ids: list[str] = []
    updated_todos: list[Todo] = []
    errors: list[str] = []
    for todo_id in body.ids:
        todo = await db.get(Todo, todo_id)
        if not todo:
            errors.append(f"Todo {todo_id} not found")
            continue
        if body.delete:
            deleted_ids.append(todo.id)
            await db.delete(todo)
            deleted += 1
        else:
            if body.status is not None:
                todo.status = body.status
                if body.status == "completed" and not todo.completed_at:
                    todo.completed_at = datetime.now(timezone.utc)
                elif body.status != "completed":
                    todo.completed_at = None
            if body.priority is not None:
                todo.priority = body.priority
            if body.tags is not None:
                todo.tags = serialize_tags(body.tags)
            todo.updated_at = datetime.now(timezone.utc)
            updated_todos.append(todo)
            updated += 1
    await db.commit()

    if settings.obsidian_vault_path:
        for tid in deleted_ids:
            remove_todo_from_vault(settings.obsidian_vault_path, tid)
        for todo in updated_todos:
            project_name = None
            if todo.parent_id:
                parent = await db.get(Todo, todo.parent_id)
                if parent:
                    project_name = parent.title
            export_todo(settings.obsidian_vault_path, todo, project_name)

    return BulkTodoResponse(updated=updated, deleted=deleted, errors=errors)


@router.post("", response_model=TodoResponse, status_code=201)
async def create_todo(
    body: TodoCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = Todo(
        id=make_id("todo_"),
        title=body.title,
        description=body.description,
        priority=body.priority,
        due_date=body.due_date,
        tags=serialize_tags(body.tags),
        parent_id=body.parent_id,
        sort_order=body.sort_order or 0,
        source=body.source,
        source_id=body.source_id,
        assignee=body.assignee,
        inbox_state=body.inbox_state,
        estimated_minutes=body.estimated_minutes,
    )
    db.add(todo)
    await db.commit()
    await db.refresh(todo)

    # Trigger inbox pipeline for quick-capture root todos
    if todo.inbox_state == "classifying" and not todo.parent_id:
        ai_service = request.app.state.ai_service
        session_factory = request.app.state.session_factory

        async def _run_pipeline():
            async with session_factory() as pipeline_db:
                await inbox_pipeline_service.process_todo(pipeline_db, ai_service, todo.id)

        background_tasks.add_task(_run_pipeline)

    if settings.obsidian_vault_path:
        project_name = None
        if todo.parent_id:
            parent = await db.get(Todo, todo.parent_id)
            if parent:
                project_name = parent.title
        export_todo(settings.obsidian_vault_path, todo, project_name)

    resp = TodoResponse.model_validate(todo)
    if todo.tags:
        resp.tags = deserialize_tags(todo.tags)
    return resp


@router.get("/{todo_id}", response_model=TodoResponse)
async def get_todo(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")
    resp = TodoResponse.model_validate(todo)
    if todo.tags:
        resp.tags = deserialize_tags(todo.tags)
    return resp


@router.patch("/{todo_id}", response_model=TodoResponse)
async def update_todo(
    todo_id: str,
    body: TodoUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    data = body.model_dump(exclude_unset=True)
    apply_model_updates(todo, data)

    # Auto-set completed_at when status changes to completed
    if "status" in data:
        if data["status"] == "completed" and not todo.completed_at:
            todo.completed_at = datetime.now(timezone.utc)
        elif data["status"] != "completed":
            todo.completed_at = None
    await db.commit()
    await db.refresh(todo)

    if settings.obsidian_vault_path:
        project_name = None
        if todo.parent_id:
            parent = await db.get(Todo, todo.parent_id)
            if parent:
                project_name = parent.title
        export_todo(settings.obsidian_vault_path, todo, project_name)

    resp = TodoResponse.model_validate(todo)
    if todo.tags:
        resp.tags = deserialize_tags(todo.tags)
    return resp


@router.delete("/{todo_id}", status_code=204)
async def delete_todo(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")
    deleted_id = todo.id
    await db.delete(todo)
    await db.commit()

    if settings.obsidian_vault_path:
        remove_todo_from_vault(settings.obsidian_vault_path, deleted_id)


@router.post("/{todo_id}/organize")
async def organize_todo(
    todo_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")
    ai_service = request.app.state.ai_service
    session_factory = request.app.state.session_factory

    async def _run_organize():
        async with session_factory() as org_db:
            await inbox_pipeline_service.process_todo(org_db, ai_service, todo_id)

    background_tasks.add_task(_run_organize)
    return {"status": "processing", "todo_id": todo_id}


@router.get("/{todo_id}/plan/latest")
async def get_latest_plan(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    q = (
        sa_select(AgentTask)
        .where(
            AgentTask.todo_id == todo_id,
            AgentTask.task_type == "plan_todo",
            AgentTask.status == "completed",
        )
        .order_by(AgentTask.created_at.desc())
        .limit(1)
    )
    task = (await db.execute(q)).scalar()
    if not task:
        raise NotFoundError("No plan found")

    payload = json.loads(task.payload_json) if task.payload_json else {}
    return PlanResponse(
        task_id=task.id,
        todo_id=todo_id,
        summary=payload.get("summary", ""),
        suggested_root_due_date=payload.get("suggested_root_due_date"),
        suggested_assignee=payload.get("suggested_assignee"),
        suggested_project_title=payload.get("suggested_project_title"),
        subtasks=payload.get("subtasks", []),
        created_at=task.created_at,
    )


@router.post("/{todo_id}/plan/apply")
async def apply_plan(
    todo_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    # Fetch latest plan
    q = (
        sa_select(AgentTask)
        .where(
            AgentTask.todo_id == todo_id,
            AgentTask.task_type == "plan_todo",
            AgentTask.status == "completed",
        )
        .order_by(AgentTask.created_at.desc())
        .limit(1)
    )
    task = (await db.execute(q)).scalar()
    if not task:
        raise NotFoundError("No plan found")

    payload = json.loads(task.payload_json) if task.payload_json else {}
    subtasks = payload.get("subtasks", [])

    created_ids: list[str] = []
    created_todos: list[Todo] = []

    # Create child todos
    for index, subtask in enumerate(subtasks):
        child = Todo(
            id=make_id("todo_"),
            parent_id=todo_id,
            title=subtask.get("title", ""),
            description=subtask.get("description"),
            estimated_minutes=subtask.get("estimated_minutes"),
            due_date=subtask.get("due_date"),
            sort_order=index,
        )
        db.add(child)
        created_ids.append(child.id)
        created_todos.append(child)

    await db.flush()

    # Create dependency relationships
    relationship_count = 0
    for index, subtask in enumerate(subtasks):
        for dep_index in subtask.get("depends_on_indices", []):
            if 0 <= dep_index < len(created_ids):
                rel = TaskRelationship(
                    id=make_id("trel_"),
                    source_todo_id=created_ids[index],
                    target_todo_id=created_ids[dep_index],
                    relationship_type="blocked_by",
                )
                db.add(rel)
                relationship_count += 1

    # Apply suggested assignee
    if payload.get("suggested_assignee"):
        todo.assignee = payload["suggested_assignee"]

    # Apply suggested root due date
    if payload.get("suggested_root_due_date"):
        todo.due_date = payload["suggested_root_due_date"]

    # Create project folder if suggested and no existing source
    project_folder_created = None
    if payload.get("suggested_project_title") and not todo.source_id:
        sanitized_title = re.sub(r'[^\w\s-]', '', payload["suggested_project_title"]).strip()
        sanitized_title = re.sub(r'\s+', '_', sanitized_title)
        if settings.obsidian_vault_path:
            folder_path = os.path.join(settings.obsidian_vault_path, sanitized_title)
            os.makedirs(folder_path, exist_ok=True)
            todo_md_path = os.path.join(folder_path, "TODO.md")
            with open(todo_md_path, "w") as f:
                f.write("## ClawChat\n")
            project_folder_created = sanitized_title
        todo.source = "obsidian_project"
        todo.source_id = sanitized_title

    # Update root todo state
    todo.inbox_state = "none"

    # Set root due_date to earliest child due_date if not already set
    if not todo.due_date:
        earliest = None
        for child in created_todos:
            if child.due_date:
                if earliest is None or child.due_date < earliest:
                    earliest = child.due_date
        if earliest:
            todo.due_date = earliest

    await db.commit()

    # Export affected todos to vault
    if settings.obsidian_vault_path:
        project_name = todo.title
        export_todo(settings.obsidian_vault_path, todo, None)
        for child in created_todos:
            export_todo(settings.obsidian_vault_path, child, project_name)

    return PlanApplyResponse(
        todo_id=todo_id,
        created_subtask_ids=created_ids,
        created_relationships=relationship_count,
        project_folder_created=project_folder_created,
    )


@router.post("/{todo_id}/plan/dismiss")
async def dismiss_plan(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")
    todo.inbox_state = "none"
    await db.commit()
    return {"status": "dismissed", "todo_id": todo_id}


@router.post("/{todo_id}/delegate")
async def delegate_todo(
    todo_id: str,
    body: DelegateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    if body.agent_type not in ("planner", "researcher", "executor"):
        raise ValueError(f"Invalid agent_type: {body.agent_type}")

    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    task = AgentTask(
        id=make_id("task_"),
        agent_type=body.agent_type,
        task_type=f"delegate_{body.agent_type}",
        instruction=f"Handle: {todo.title}\n{todo.description or ''}",
        todo_id=todo.id,
    )
    db.add(task)
    await db.flush()

    ai_service = request.app.state.ai_service

    if body.agent_type == "planner":
        await inbox_pipeline_service.process_todo(db, ai_service, todo_id)
    else:
        # Use vault agent service for researcher/executor (creates vault documents)
        try:
            from services.vault_agent_service import execute_agent_task
            await execute_agent_task(db, ai_service, task)
        except ImportError:
            from services.agent_task_service import execute_task
            await execute_task(db, ai_service, task.id)

    todo.assignee = body.agent_type
    await db.commit()

    return {"status": "delegated", "task_id": task.id, "agent_type": body.agent_type}
