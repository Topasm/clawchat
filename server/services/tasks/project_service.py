"""First-class project CRUD and legacy-root compatibility helpers."""

from datetime import datetime, timezone

from domain.project import ProjectStatus
from domain.graph_insights import GraphDueRisk
from domain.task import TaskStatus
from exceptions import NotFoundError
from models.conversation import Conversation
from models.project import Project
from models.review_item import ReviewItem
from models.agent_run import AgentRun
from domain.agent_run import AGENT_RUN_EXECUTING_STATUSES
from models.todo import Todo
from schemas.project import ProjectOverviewResponse, ProjectResponse
from services.tasks import graph_insights_service
from sqlalchemy import case, func, select
from domain.review import ReviewStatus
from sqlalchemy.ext.asyncio import AsyncSession
from utils import apply_model_updates, make_id


async def get_project(db: AsyncSession, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise NotFoundError(f"Project {project_id} not found")
    return project


async def create_project(
    db: AsyncSession,
    *,
    title: str,
    goal: str | None = None,
    description: str | None = None,
    status: ProjectStatus = ProjectStatus.ACTIVE,
    deadline: datetime | None = None,
    default_execution_provider: str | None = None,
    default_execution_model: str | None = None,
    execution_workspace_path: str | None = None,
    execution_workspace_isolation: str = "local",
    execution_base_branch: str | None = None,
) -> Project:
    project = Project(
        id=make_id("project_"),
        title=title,
        goal=goal,
        description=description,
        status=status,
        deadline=deadline,
        default_execution_provider=default_execution_provider,
        default_execution_model=default_execution_model,
        execution_workspace_path=execution_workspace_path,
        execution_workspace_isolation=execution_workspace_isolation,
        execution_base_branch=execution_base_branch,
    )
    db.add(project)
    await db.flush()

    # The root task remains a graph container for backward-compatible Task
    # views, while Project owns identity, context, lifecycle, and revision.
    root = Todo(
        id=make_id("todo_"),
        project_id=project.id,
        title=title,
        description=description or goal,
        status=(
            TaskStatus.COMPLETED
            if status == ProjectStatus.COMPLETED
            else TaskStatus.PENDING
        ),
        priority="medium",
        due_date=deadline,
        source="project_root",
    )
    db.add(root)
    await db.flush()
    project.root_task_id = root.id
    await db.flush()
    return project


async def update_project(
    db: AsyncSession,
    project_id: str,
    **updates,
) -> Project:
    project = await get_project(db, project_id)
    apply_model_updates(project, updates)
    root = await db.get(Todo, project.root_task_id) if project.root_task_id else None
    if root is not None:
        if "title" in updates:
            root.title = project.title
        if "description" in updates or "goal" in updates:
            root.description = project.description or project.goal
        if "deadline" in updates:
            root.due_date = project.deadline
        if "status" in updates:
            if project.status == ProjectStatus.COMPLETED:
                root.status = TaskStatus.COMPLETED
                root.completed_at = datetime.now(timezone.utc)
            elif root.status == TaskStatus.COMPLETED:
                root.status = TaskStatus.PENDING
                root.completed_at = None
    await db.flush()
    return project


async def _project_counts(db: AsyncSession):
    counts = (
        select(
            Todo.project_id.label("project_id"),
            func.count(Todo.id).label("task_count"),
            func.sum(
                case((Todo.status == TaskStatus.COMPLETED, 1), else_=0)
            ).label("completed_task_count"),
        )
        .where(Todo.project_id.is_not(None))
        .group_by(Todo.project_id)
        .subquery()
    )
    conversations = (
        select(
            Conversation.project_id.label("project_id"),
            func.min(Conversation.id).label("conversation_id"),
        )
        .where(
            Conversation.project_id.is_not(None),
            Conversation.is_archived.is_(False),
        )
        .group_by(Conversation.project_id)
        .subquery()
    )
    return counts, conversations


async def list_projects(
    db: AsyncSession,
    *,
    include_archived: bool = False,
) -> list[ProjectResponse]:
    counts, conversations = await _project_counts(db)
    query = (
        select(
            Project,
            func.coalesce(counts.c.task_count, 0),
            func.coalesce(counts.c.completed_task_count, 0),
            conversations.c.conversation_id,
        )
        .outerjoin(counts, counts.c.project_id == Project.id)
        .outerjoin(conversations, conversations.c.project_id == Project.id)
        .order_by(Project.updated_at.desc(), Project.id.asc())
    )
    if not include_archived:
        query = query.where(Project.status != ProjectStatus.ARCHIVED)
    rows = (await db.execute(query)).all()
    return [
        ProjectResponse.model_validate(project).model_copy(
            update={
                "task_count": max(
                    0,
                    task_count - (1 if project.root_task_id else 0),
                ),
                "completed_task_count": max(
                    0,
                    completed_task_count
                    - (
                        1
                        if project.root_task_id
                        and project.status == ProjectStatus.COMPLETED
                        else 0
                    ),
                ),
                "conversation_id": conversation_id,
            }
        )
        for project, task_count, completed_task_count, conversation_id in rows
    ]


async def build_project_response(
    db: AsyncSession,
    project: Project,
) -> ProjectResponse:
    items = await list_projects(db, include_archived=True)
    return next(item for item in items if item.id == project.id)


async def build_project_overview(
    db: AsyncSession,
    project: Project,
) -> ProjectOverviewResponse:
    response = await build_project_response(db, project)
    insights = await graph_insights_service.get_graph_insights(
        db,
        root_task_id=project.root_task_id,
        limit=graph_insights_service.DEFAULT_GRAPH_INSIGHT_LIMIT,
    )
    work_nodes = [
        node
        for node in insights.nodes
        if node.task_id != project.root_task_id and not node.is_container
    ]
    pending_review_count = (
        await db.execute(
            select(func.count(ReviewItem.id)).where(
                ReviewItem.project_id == project.id,
                ReviewItem.status == ReviewStatus.PENDING,
            )
        )
    ).scalar_one()
    running_agent_count = (
        await db.execute(
            select(func.count(AgentRun.id)).where(
                AgentRun.project_id == project.id,
                AgentRun.status.in_(AGENT_RUN_EXECUTING_STATUSES),
            )
        )
    ).scalar_one()
    return ProjectOverviewResponse(
        **response.model_dump(),
        ready_count=sum(node.is_ready for node in work_nodes),
        blocked_count=sum(node.is_blocked for node in work_nodes),
        at_risk_count=sum(
            node.due_risk
            in (
                GraphDueRisk.OVERDUE,
                GraphDueRisk.BLOCKED,
                GraphDueRisk.INSUFFICIENT_TIME,
            )
            for node in work_nodes
        ),
        critical_path_minutes=insights.summary.critical_path_minutes,
        pending_review_count=pending_review_count,
        running_agent_count=running_agent_count,
    )
