"""Project context blocks appended to the chat system prompt.

Shared by both chat transports. These lived as byte-identical copies in the SSE
router and the orchestrator, so a prompt change applied to one path and not the
other -- exactly the kind of drift that made the two paths behave differently.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.agent_run import AGENT_RUN_ACTIVE_STATUSES, AgentRunStatus
from domain.review import ReviewStatus, ReviewSubjectType
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.conversation import Conversation
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from services.agents import execution_host_service

#: The folder snapshot rides along every project chat turn, so it gets a
#: smaller share of the prompt than an execution instruction does.
PROJECT_CHAT_WORKSPACE_CHARS = 4_000


async def build_conversation_context(db: AsyncSession, conversation: Conversation | None) -> str:
    """Everything appended to the system prompt for one conversation.

    The project block says what the work is; the agent block says where the
    agent is with it. Without the second, "how is the research going?" was
    answered from nothing, however many runs were under way.
    """
    if conversation is None:
        return ""
    context = ""
    if conversation.project_id:
        context += await build_first_class_project_context(db, conversation.project_id)
    elif conversation.project_todo_id:
        context += await build_project_context(db, conversation.project_todo_id)
    context += await build_agent_activity_context(
        db,
        project_id=conversation.project_id,
        conversation_id=conversation.id,
    )
    return context


async def collect_agent_activity(
    db: AsyncSession,
    *,
    project_id: str | None = None,
    conversation_id: str | None = None,
) -> tuple[list[tuple[AgentRun, AgentTask, Todo | None]], list[ReviewItem]]:
    """Active runs and pending run reviews, scoped to a project or a thread.

    With neither scope the whole workspace is returned, which is what a
    status question in an unscoped chat is asking about.
    """
    query = (
        select(AgentRun, AgentTask)
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(
            AgentRun.status.in_(AGENT_RUN_ACTIVE_STATUSES),
            AgentTask.parent_task_id.is_(None),
        )
        .order_by(AgentRun.created_at.desc())
    )
    if project_id:
        query = query.where(AgentRun.project_id == project_id)
    elif conversation_id:
        query = query.where(AgentTask.conversation_id == conversation_id)
    rows = list((await db.execute(query)).all())
    activity: list[tuple[AgentRun, AgentTask, Todo | None]] = []
    for run, task in rows:
        todo = await db.get(Todo, task.todo_id) if task.todo_id else None
        activity.append((run, task, todo))

    reviews_query = select(ReviewItem).where(
        ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
        ReviewItem.status == ReviewStatus.PENDING,
    )
    if project_id:
        reviews_query = reviews_query.where(ReviewItem.project_id == project_id)
    elif conversation_id:
        reviews_query = reviews_query.where(
            ReviewItem.subject_id.in_([run.id for run, _task, _todo in activity])
        )
    reviews = list((await db.execute(reviews_query)).scalars().all())
    return activity, reviews


def run_title(run: AgentRun, task: AgentTask, todo: Todo | None) -> str:
    return todo.title if todo is not None else task.instruction.splitlines()[0][:80]


def describe_run(run: AgentRun, task: AgentTask, todo: Todo | None) -> str:
    """One line a model or a person can read: state, title, what it needs."""
    title = run_title(run, task, todo)
    status = AgentRunStatus(run.status)
    if status == AgentRunStatus.WAITING_INPUT:
        question = (run.progress_message or "").strip()
        return f"waiting for your input: {title}" + (f" — {question}" if question else "")
    if status == AgentRunStatus.WAITING_REVIEW:
        return f"waiting for your review: {title}"
    progress = f" ({run.progress}%)" if run.progress else ""
    message = (run.progress_message or "").strip()
    return f"{status.value.replace('_', ' ')}: {title}{progress}" + (
        f" — {message}" if message else ""
    )


async def build_agent_activity_context(
    db: AsyncSession,
    *,
    project_id: str | None = None,
    conversation_id: str | None = None,
) -> str:
    activity, reviews = await collect_agent_activity(
        db, project_id=project_id, conversation_id=conversation_id
    )
    if not activity and not reviews:
        return ""
    context = "\n\n[Agent activity]\n"
    if activity:
        context += f"Runs ({len(activity)}):\n"
        for run, task, todo in activity:
            context += f"  - {describe_run(run, task, todo)}\n"
    if reviews:
        context += f"Results waiting for the user's review: {len(reviews)}\n"
    context += (
        "The user answers a waiting run or reviews a result from the run's card "
        "in this thread, the Runs page, or the Review page.\n"
    )
    return context


async def build_project_context(db: AsyncSession, project_todo_id: str) -> str:
    """Context for a legacy todo-backed project."""
    project = await db.get(Todo, project_todo_id)
    if not project:
        return ""

    subtasks = (
        await db.execute(select(Todo).where(Todo.parent_id == project_todo_id))
    ).scalars().all()

    ctx = f"\n\n[Project: {project.title}]\n"
    if project.description:
        ctx += f"Project Notes:\n{project.description}\n"
    if subtasks:
        ctx += f"Tasks ({len(subtasks)}):\n"
        for task in subtasks:
            ctx += f"  - [{task.status}] {task.title}\n"
    return ctx


async def build_first_class_project_context(db: AsyncSession, project_id: str) -> str:
    """Context for a first-class Project row."""
    project = await db.get(Project, project_id)
    if project is None:
        return ""

    tasks = list(
        (
            await db.execute(
                select(Todo)
                .where(
                    Todo.project_id == project_id,
                    Todo.id != project.root_task_id,
                )
                .order_by(Todo.sort_order, Todo.created_at)
            )
        ).scalars().all()
    )

    context = f"\n\n[Project: {project.title}]\n"
    if project.goal:
        context += f"Goal: {project.goal}\n"
    if project.description:
        context += f"Project Notes:\n{project.description}\n"
    if project.deadline:
        context += f"Deadline: {project.deadline.isoformat()}\n"
    # Where the project lives and what that folder says about itself, so
    # "explain this folder" can be answered from the machine's own README.
    # Kept shorter than the execution copy: this rides along every chat turn.
    workspace_block = await execution_host_service.workspace_context_block(
        db, project, max_chars=PROJECT_CHAT_WORKSPACE_CHARS
    )
    if workspace_block:
        context += f"{workspace_block}\n"
    if tasks:
        context += f"Tasks ({len(tasks)}):\n"
        for task in tasks:
            context += f"  - [{task.status}] {task.title}\n"
    return context
