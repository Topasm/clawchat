"""Project context blocks appended to the chat system prompt.

Shared by both chat transports. These lived as byte-identical copies in the SSE
router and the orchestrator, so a prompt change applied to one path and not the
other -- exactly the kind of drift that made the two paths behave differently.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.project import Project
from models.todo import Todo


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
            ctx += f"  - [{task.status}] {task.title}"
            if task.priority != "medium":
                ctx += f" ({task.priority})"
            ctx += "\n"
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
    if tasks:
        context += f"Tasks ({len(tasks)}):\n"
        for task in tasks:
            context += f"  - [{task.status}] {task.title}\n"
    return context
