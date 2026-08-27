import json
import logging
from datetime import datetime, timezone

from auth.dependencies import get_current_user
from config import settings
from database import get_db
from domain.plan_proposal import PlanProposalStatus
from domain.task import TaskStatus
from exceptions import AppError, NotFoundError
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.plan_proposal import PlanProposal
from models.todo import Todo
from schemas.bulk import BulkTodoResponse, BulkTodoUpdate
from schemas.common import (
    ErrorResponse,
    PaginatedResponse,
    RequestValidationErrorResponse,
)
from schemas.graph_insights import GraphInsightsResponse
from schemas.task import (
    DelegateRequest,
    PlanApplyRequest,
    PlanApplyResponse,
    PlanDismissRequest,
    PlanDismissResponse,
    PlanGenerateRequest,
    PlanResponse,
    SkillResponse,
)
from schemas.todo import (
    AnswerQuestionsRequest,
    ProjectTodoResponse,
    TodoCreate,
    TodoResponse,
    TodoUpdate,
)
from services import (
    graph_insights_service,
    inbox_pipeline_service,
    plan_proposal_service,
    task_relationship_service,
    todo_service,
    vault_sync_service,
)
from services.obsidian_export_service import (
    export_todos_batch,
    remove_todos_from_vault,
)
from skills import PERSONA_TO_SKILL, SKILL_REGISTRY, get_skill
from sqlalchemy import case, func, select
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import deserialize_tags, make_id, serialize_tags
from utils.inbox_display import get_next_action
from ws.notifications import notify_module_data_changed

router = APIRouter()
logger = logging.getLogger(__name__)

# -- Assignee / skill display labels -------------------------------------------

_LEGACY_ASSIGNEE_LABELS = {
    "planner": "Planner",
    "researcher": "Researcher",
    "executor": "Executor",
}


def _skill_label(skill_id: str) -> str:
    """Return a human-readable label for a skill or legacy persona."""
    skill = get_skill(skill_id)
    if skill:
        return skill.name
    return _LEGACY_ASSIGNEE_LABELS.get(skill_id, skill_id.replace("_", " ").title())


def _humanize_folder_name(source_id: str | None) -> str | None:
    """Derive a human-readable project label from source_id (folder name)."""
    if not source_id:
        return None
    return source_id.replace("_", " ").replace("-", " ").strip().title()


def _schedule_vault_sync(
    background_tasks: BackgroundTasks,
    request: Request,
    job_id: str | None,
) -> None:
    if job_id is None:
        return
    session_factory = getattr(request.app.state, "session_factory", None)
    if session_factory is None:
        logger.warning("Vault sync job %s remains pending: no session factory", job_id)
        return

    async def _process() -> None:
        try:
            async with session_factory() as job_db:
                await vault_sync_service.process_vault_sync_job(job_db, job_id)
        except Exception:
            logger.exception("Background Vault sync job %s failed", job_id)

    background_tasks.add_task(_process)


def _compute_sync_status(source: str | None) -> str | None:
    """Derive Obsidian sync status from source field."""
    if source == "obsidian_project":
        return "synced"
    if source and source.startswith("obsidian"):
        return "linked"
    return None


async def _enrich_todo_response(
    todo: Todo, db: AsyncSession, *, include_plan_summary: bool = True
) -> TodoResponse:
    """Build a TodoResponse with computed display fields."""
    resp = TodoResponse.model_validate(todo)
    if todo.tags:
        resp.tags = deserialize_tags(todo.tags)

    # is_recurring
    resp.is_recurring = bool(todo.recurrence_rule)

    # next_action
    resp.next_action = get_next_action(
        todo.inbox_state or "none", todo.status or TaskStatus.PENDING
    )

    # sync_status
    resp.sync_status = _compute_sync_status(todo.source)

    # project_label
    resp.project_label = _humanize_folder_name(todo.source_id)

    # plan_summary — only fetch when inbox_state is plan_ready
    if include_plan_summary and todo.inbox_state == "plan_ready":
        plan_q = (
            sa_select(PlanProposal)
            .where(
                PlanProposal.root_task_id == todo.id,
                PlanProposal.status == PlanProposalStatus.DRAFT,
            )
            .order_by(PlanProposal.created_at.desc())
            .limit(1)
        )
        proposal = (await db.execute(plan_q)).scalar()
        if proposal and proposal.payload_json:
            payload = json.loads(proposal.payload_json)
            resp.plan_summary = payload.get("summary")

    return resp


@router.get("/projects", response_model=list[ProjectTodoResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """List root todos that qualify as projects.

    A root todo is a project if it has subtasks, a linked conversation, or
    an explicit source (e.g. obsidian_project).  Simple inbox captures and
    standalone tasks are excluded.
    """
    child_counts = (
        select(
            Todo.parent_id.label("parent_id"),
            func.count(Todo.id).label("subtask_count"),
            func.sum(case((Todo.status == TaskStatus.COMPLETED, 1), else_=0)).label(
                "completed_count"
            ),
        )
        .where(Todo.parent_id.is_not(None))
        .group_by(Todo.parent_id)
        .subquery()
    )
    conversations = (
        select(
            Conversation.project_todo_id.label("project_todo_id"),
            func.min(Conversation.id).label("conversation_id"),
        )
        .where(
            Conversation.project_todo_id.is_not(None),
            Conversation.is_archived.is_(False),
        )
        .group_by(Conversation.project_todo_id)
        .subquery()
    )
    q = (
        select(
            Todo,
            conversations.c.conversation_id,
            func.coalesce(child_counts.c.subtask_count, 0),
            func.coalesce(child_counts.c.completed_count, 0),
        )
        .outerjoin(child_counts, child_counts.c.parent_id == Todo.id)
        .outerjoin(conversations, conversations.c.project_todo_id == Todo.id)
        .where(Todo.parent_id.is_(None))
        .order_by(Todo.updated_at.desc())
    )
    root_todos = (await db.execute(q)).all()

    items = []
    for todo, conv_id, subtask_count, completed_count in root_todos:
        # Only include as a project if it has subtasks, a conversation, or a source
        has_subtasks = subtask_count > 0
        has_conversation = conv_id is not None
        has_source = bool(todo.source)
        if not (has_subtasks or has_conversation or has_source):
            continue

        resp = ProjectTodoResponse(
            id=todo.id,
            title=todo.title,
            description=todo.description,
            status=todo.status,
            priority=todo.priority,
            due_date=todo.due_date,
            completed_at=todo.completed_at,
            tags=deserialize_tags(todo.tags) if todo.tags else None,
            parent_id=todo.parent_id,
            sort_order=todo.sort_order,
            source=todo.source,
            source_id=todo.source_id,
            assignee=todo.assignee,
            created_at=todo.created_at,
            updated_at=todo.updated_at,
            conversation_id=conv_id,
            subtask_count=subtask_count,
            completed_subtask_count=completed_count,
        )
        items.append(resp)

    return items


@router.get(
    "/graph/insights",
    response_model=GraphInsightsResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid graph scope"},
        404: {"model": ErrorResponse, "description": "Root todo not found"},
        409: {"model": ErrorResponse, "description": "Graph changed during read"},
    },
)
async def get_graph_insights(
    root_task_id: str | None = None,
    limit: int = Query(
        graph_insights_service.DEFAULT_GRAPH_INSIGHT_LIMIT,
        ge=1,
        le=graph_insights_service.MAX_GRAPH_INSIGHT_LIMIT,
    ),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Return deterministic execution insights for a project or global graph."""

    return await graph_insights_service.get_graph_insights(
        db,
        root_task_id=root_task_id,
        limit=limit,
    )


@router.get("", response_model=PaginatedResponse[TodoResponse])
async def list_todos(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=1000),
    status: TaskStatus | None = None,
    priority: str | None = None,
    due_before: datetime | None = None,
    parent_id: str | None = None,
    root_only: bool = False,
    order_by: str = "created_at",
    order_dir: str = "desc",
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    rows, total = await todo_service.get_todos(
        db,
        status_filter=status,
        priority=priority,
        due_before=due_before,
        parent_id=parent_id,
        root_only=root_only,
        order_by=order_by,
        order_dir=order_dir,
        page=page,
        limit=limit,
    )

    items = []
    for row in rows:
        resp = await _enrich_todo_response(row, db, include_plan_summary=False)
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
    todo_rows = await db.execute(select(Todo).where(Todo.id.in_(body.ids)))
    todos_by_id = {todo.id: todo for todo in todo_rows.scalars().all()}
    deleted_todo_ids = set(todos_by_id) if body.delete else set()
    dependent_source_ids = await task_relationship_service.dependent_source_ids(
        db,
        deleted_todo_ids,
    )
    for todo_id in body.ids:
        todo = todos_by_id.get(todo_id)
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
                if body.status == TaskStatus.COMPLETED and not todo.completed_at:
                    todo.completed_at = datetime.now(timezone.utc)
                elif body.status != TaskStatus.COMPLETED:
                    todo.completed_at = None
            if body.priority is not None:
                todo.priority = body.priority
            if body.tags is not None:
                todo.tags = serialize_tags(body.tags)
            todo.updated_at = datetime.now(timezone.utc)
            updated_todos.append(todo)
            updated += 1
    await db.flush()
    await task_relationship_service.sync_dependency_shadows(
        db,
        dependent_source_ids,
    )
    await db.commit()

    if settings.obsidian_vault_path:
        remove_todos_from_vault(
            settings.obsidian_vault_path,
            set(deleted_ids) | {todo.id for todo in updated_todos},
        )
        parent_ids = {todo.parent_id for todo in updated_todos if todo.parent_id}
        parent_titles = {}
        if parent_ids:
            parent_rows = await db.execute(
                select(Todo.id, Todo.title).where(Todo.id.in_(parent_ids))
            )
            parent_titles = dict(parent_rows.all())
        export_todos_batch(
            settings.obsidian_vault_path,
            [
                (todo, parent_titles.get(todo.parent_id) if todo.parent_id else None)
                for todo in updated_todos
            ],
            remove_existing=False,
        )

    await notify_module_data_changed("todos")
    return BulkTodoResponse(updated=updated, deleted=deleted, errors=errors)


@router.post("", response_model=TodoResponse, status_code=201)
async def create_todo(
    body: TodoCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await todo_service.create_todo(
        db,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        due_date=body.due_date,
        tags=body.tags,
        parent_id=body.parent_id,
        sort_order=body.sort_order or 0,
        source=body.source,
        source_id=body.source_id,
        assignee=body.assignee,
        enabled_skills=body.enabled_skills,
        inbox_state=body.inbox_state,
        estimated_minutes=body.estimated_minutes,
        depends_on=body.depends_on,
        recurrence_rule=body.recurrence_rule,
        recurrence_end=body.recurrence_end,
    )
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

    await notify_module_data_changed("todos")
    return await _enrich_todo_response(todo, db)


@router.get("/{todo_id}", response_model=TodoResponse)
async def get_todo(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    todo = await todo_service.get_todo(db, todo_id)
    return await _enrich_todo_response(todo, db)


@router.patch("/{todo_id}", response_model=TodoResponse)
async def update_todo(
    todo_id: str,
    body: TodoUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    data = body.model_dump(exclude_unset=True)
    todo = await todo_service.update_todo(db, todo_id, **data)
    await db.commit()
    await db.refresh(todo)

    # Spawn next occurrence for recurring tasks on completion
    next_todo_id = None
    if (
        "status" in data
        and data["status"] == TaskStatus.COMPLETED
        and todo.recurrence_rule
    ):
        from services.todo_recurrence_service import spawn_next_occurrence
        next_todo = await spawn_next_occurrence(db, todo)
        if next_todo:
            next_todo_id = next_todo.id
            await db.commit()

    await notify_module_data_changed("todos")
    resp = await _enrich_todo_response(todo, db)
    # Include next occurrence ID in response headers for client to pick up
    if next_todo_id:
        resp.next_action = f"Next occurrence created: {next_todo_id}"
    return resp


@router.delete("/{todo_id}", status_code=204)
async def delete_todo(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    await todo_service.delete_todo(db, todo_id)
    await db.commit()

    await notify_module_data_changed("todos")


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


@router.post("/{todo_id}/answer-questions")
async def answer_questions(
    todo_id: str,
    body: AnswerQuestionsRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Accept user answers to clarification questions and trigger planning."""
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    if todo.inbox_state != "questioning":
        return {"status": "invalid_state", "todo_id": todo_id, "inbox_state": todo.inbox_state}

    # Save answers
    todo.clarification_answers = json.dumps(body.answers)
    todo.inbox_state = "planning"
    await db.commit()
    await notify_module_data_changed("todos")

    # Trigger planning in background with Q&A context
    ai_service = request.app.state.ai_service
    session_factory = request.app.state.session_factory

    async def _run_planning():
        async with session_factory() as pipeline_db:
            await inbox_pipeline_service.resume_after_answers(pipeline_db, ai_service, todo_id)

    background_tasks.add_task(_run_planning)
    return {"status": "processing", "todo_id": todo_id}


@router.post("/{todo_id}/skip-questions")
async def skip_questions(
    todo_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Skip clarification questions and proceed directly to planning."""
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    if todo.inbox_state != "questioning":
        return {"status": "invalid_state", "todo_id": todo_id, "inbox_state": todo.inbox_state}

    todo.inbox_state = "planning"
    await db.commit()
    await notify_module_data_changed("todos")

    # Trigger planning in background without Q&A context
    ai_service = request.app.state.ai_service
    session_factory = request.app.state.session_factory

    async def _run_planning():
        async with session_factory() as pipeline_db:
            await inbox_pipeline_service.resume_after_answers(pipeline_db, ai_service, todo_id)

    background_tasks.add_task(_run_planning)
    return {"status": "processing", "todo_id": todo_id}


@router.get(
    "/{todo_id}/plan/latest",
    response_model=PlanResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_latest_plan(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    proposal = await plan_proposal_service.get_latest_proposal(db, todo_id)
    return await plan_proposal_service.build_plan_response(db, proposal)


@router.post(
    "/{todo_id}/plan/generate",
    response_model=PlanResponse,
    responses={
        404: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
)
async def generate_graph_plan(
    todo_id: str,
    body: PlanGenerateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Generate and persist a proposal without creating any child todos."""
    try:
        ai_service = getattr(request.app.state, "active_ai", None)
        if ai_service is None:
            ai_service = request.app.state.ai_service
        result = await plan_proposal_service.generate_proposal(
            db,
            ai_service,
            todo_id,
            additional_instructions=body.instructions,
            model_provider=getattr(
                request.app.state,
                "active_ai_provider",
                "openclaw",
            ),
        )
        await notify_module_data_changed("todos")
        return result
    except AppError:
        await notify_module_data_changed("todos")
        raise
    except Exception as exc:
        logger.exception("AI plan generation failed for todo %s", todo_id)
        await notify_module_data_changed("todos")
        raise AppError(
            code="PLAN_GENERATION_FAILED",
            message="AI plan generation failed",
            status_code=502,
        ) from exc


@router.post(
    "/{todo_id}/plan/apply",
    response_model=PlanApplyResponse,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse | RequestValidationErrorResponse},
    },
)
async def apply_plan(
    todo_id: str,
    body: PlanApplyRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    response, job_id = await plan_proposal_service.apply_proposal(
        db,
        todo_id,
        body,
    )
    _schedule_vault_sync(background_tasks, request, job_id)
    await notify_module_data_changed("todos")
    return response


@router.post(
    "/{todo_id}/plan/dismiss",
    response_model=PlanDismissResponse,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def dismiss_plan(
    todo_id: str,
    body: PlanDismissRequest,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    response = await plan_proposal_service.dismiss_proposal(
        db,
        todo_id,
        body.proposal_id,
    )
    await notify_module_data_changed("todos")
    return response


@router.post("/{todo_id}/delegate")
async def delegate_todo(
    todo_id: str,
    body: DelegateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    # Resolve skill_id — prefer skill_id, fall back to legacy agent_type mapping.
    skill_id = body.skill_id
    if not skill_id and body.agent_type:
        skill_id = PERSONA_TO_SKILL.get(body.agent_type, body.agent_type)
    if not skill_id or skill_id not in SKILL_REGISTRY:
        raise ValueError(f"Unknown skill: {skill_id}")

    todo = await db.get(Todo, todo_id)
    if not todo:
        raise NotFoundError("Todo not found")

    task = AgentTask(
        id=make_id("task_"),
        agent_type=skill_id,
        task_type=f"delegate_{skill_id}",
        instruction=f"Handle: {todo.title}\n{todo.description or ''}",
        todo_id=todo.id,
        skill_chain=json.dumps([skill_id]),
    )
    db.add(task)
    await db.flush()

    ai_service = request.app.state.ai_service

    if skill_id == "plan":
        await inbox_pipeline_service.process_todo(db, ai_service, todo_id)
    else:
        # Use vault agent service (creates vault documents via skill template)
        try:
            from services.vault_agent_service import execute_agent_task
            await execute_agent_task(db, ai_service, task)
        except ImportError:
            from services.agent_task_service import execute_task
            await execute_task(db, ai_service, task.id)

    # Update todo with skill assignment.
    todo.assignee = skill_id  # backward compat
    # Merge into enabled_skills (additive).
    existing: list[str] = json.loads(todo.enabled_skills) if todo.enabled_skills else []
    if skill_id not in existing:
        existing.append(skill_id)
    todo.enabled_skills = json.dumps(existing)
    await db.commit()

    return {
        "status": "delegated",
        "task_id": task.id,
        "skill_id": skill_id,
        "skill_chain": [skill_id],
        "agent_type": skill_id,  # backward compat
    }


@router.get("/skills/list")
async def list_skills(
    _user: str = Depends(get_current_user),
):
    """Return all registered skills."""
    return {
        "skills": [
            SkillResponse(
                id=s.id,
                name=s.name,
                description=s.description,
                tags=list(s.tags),
            )
            for s in sorted(SKILL_REGISTRY.values(), key=lambda s: s.id)
        ]
    }
