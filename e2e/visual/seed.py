"""Seed a fresh database with the fixture the web screenshots render.

Run from the repository root with the server's environment:

    DATABASE_URL=sqlite+aiosqlite:///./e2e/visual/.data/visual.db \\
        uv run --project server python e2e/visual/seed.py

Every row carries a fixed March 2030 timestamp, and the browser clock is
pinned to the same morning (see visual.spec.ts), so relative dates such as
"in 2 days" or "overdue" read the same on every run.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))

from database import async_session_factory, init_db  # noqa: E402
from models.agent_run import AgentRun  # noqa: E402
from models.agent_task import AgentTask  # noqa: E402
from models.project import Project  # noqa: E402
from models.todo import Todo  # noqa: E402
from services.tasks import project_service  # noqa: E402

NOW = datetime(2030, 3, 12, 9, 0, tzinfo=timezone.utc)
FIXTURE_IDS = {
    "project": "project_visual_berlin",
    "task": "todo_visual_slides",
}


def at(days: float = 0, hours: float = 0) -> datetime:
    return NOW + timedelta(days=days, hours=hours)


def stamp(row, created: datetime) -> None:
    row.created_at = created
    row.updated_at = created


async def seed() -> None:
    await init_db()
    async with async_session_factory() as db:
        project = await project_service.create_project(
            db,
            title="Berlin conference talk",
            goal="Give the talk on April 9 and get there and back on budget.",
        )
        # Stable ids so the spec can open the project and a task directly.
        root_id = project.root_task_id
        await db.flush()
        project_row = await db.get(Project, project.id)
        stamp(project_row, at(-6))
        root = await db.get(Todo, root_id)
        stamp(root, at(-6))

        def child(title: str, *, days_due: float | None, status: str = "pending", hours_ago: float = 30, **extra) -> Todo:
            todo = Todo(
                title=title,
                project_id=project.id,
                parent_id=root_id,
                status=status,
                due_date=at(days_due) if days_due is not None else None,
                **extra,
            )
            stamp(todo, at(hours=-hours_ago))
            db.add(todo)
            return todo

        slides = child(
            "Draft the slides",
            days_due=3,
            id=FIXTURE_IDS["task"],
            description="Twenty minutes: the problem, the system, the numbers, one live demo.",
            tags=json.dumps(["talk", "writing"]),
        )
        # Distinct creation times: rows with equal timestamps have no stable order.
        child("Book flights to Berlin", days_due=1, hours_ago=31)
        child("Reserve a hotel near the venue", days_due=2, hours_ago=32)
        child("Rehearse with the team", days_due=10, hours_ago=33)
        child("Send the abstract", days_due=-4, status="completed", hours_ago=120)

        for title, state, hours_ago in [
            ("Ideas for the offsite agenda", "captured", 2),
            ("Reply to Mina about the budget", "plan_ready", 5),
            ("Renew the domain before it lapses", "captured", 20),
        ]:
            todo = Todo(title=title, inbox_state=state)
            stamp(todo, at(hours=-hours_ago))
            db.add(todo)

        for index, (title, days_due) in enumerate([
            ("Pay the electricity bill", 0.5),
            ("Return the library books", 4),
        ]):
            todo = Todo(title=title, due_date=at(days_due))
            stamp(todo, at(-2, hours=-index))
            db.add(todo)

        await db.flush()

        async def run(title: str, todo: Todo | None, status: str, *, minutes_ago: int, **extra) -> None:
            task = AgentTask(
                task_type="research",
                instruction=title,
                todo_id=todo.id if todo else None,
                agent_type="research",
                status="running",
            )
            task.created_at = at(hours=-minutes_ago / 60)
            db.add(task)
            await db.flush()
            run_row = AgentRun(
                agent_task_id=task.id,
                attempt=1,
                instruction_snapshot=title,
                provider="codex_cli",
                status=status,
                project_id=project.id if todo else None,
                **extra,
            )
            stamp(run_row, at(hours=-minutes_ago / 60))
            db.add(run_row)

        await run(
            "Find three hotels within walking distance of the venue",
            slides,
            "waiting_input",
            minutes_ago=25,
            progress_message="Which nights should I search for?",
        )
        await run("Summarize last year's conference reviews", None, "failed", minutes_ago=90, error="The CLI exited before finishing.")
        # No "running" run: the server fails runs with no live process when it
        # starts, so one here would render as failed.

        await db.commit()
    print(f"seeded project {project.id} and task {FIXTURE_IDS['task']}")


if __name__ == "__main__":
    asyncio.run(seed())
