"""Seed the database the README media are rendered from.

Starts from the web screenshot fixture (e2e/visual/seed.py) and adds what the
README screens need on top: a week of calendar events, a result waiting for
review and one already approved, and the chat thread behind the result.

    DATABASE_URL=sqlite+aiosqlite:///./e2e/readme/.data/readme.db \\
        uv run --project server python e2e/readme/seed.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "e2e" / "visual"))

import seed as visual_seed  # noqa: E402  (e2e/visual/seed.py)
from sqlalchemy import select  # noqa: E402

from database import async_session_factory  # noqa: E402
from models.agent_run import AgentRun  # noqa: E402
from models.agent_task import AgentTask  # noqa: E402
from models.conversation import Conversation  # noqa: E402
from models.event import Event  # noqa: E402
from models.message import Message  # noqa: E402
from models.project import Project  # noqa: E402
from models.review_item import ReviewItem  # noqa: E402
from models.todo import Todo  # noqa: E402

NOW = visual_seed.NOW
at = visual_seed.at
stamp = visual_seed.stamp

CONVERSATION_ID = "conv_readme_hotels"

HOTEL_RESULT = """\
Three hotels within walking distance of the venue, all with rooms free for April 8 to 10:

1. Hotel Oderberger, 6 minutes on foot, 420 EUR for the three nights. Quiet street, breakfast included.
2. Linnen, 9 minutes, 390 EUR. Small rooms, the best reviews for sleep.
3. Michelberger, 12 minutes, 450 EUR. Lively, good for the speakers' dinner.

Oderberger is the safest pick: closest to the venue, and the rate is refundable until April 1.
"""


async def seed() -> None:
    await visual_seed.seed()
    async with async_session_factory() as db:
        project = (
            await db.execute(select(Project).where(Project.title == "Berlin conference talk"))
        ).scalar_one()
        flights = (
            await db.execute(select(Todo).where(Todo.title == "Book flights to Berlin"))
        ).scalar_one()
        abstract = (await db.execute(select(Todo).where(Todo.title == "Send the abstract"))).scalar_one()

        # The fixture week: Monday March 11 to Sunday March 17, 2030 (NOW is the
        # Wednesday). Project events give the Schedule a second colour.
        def event(title: str, *, day: int, hour: float, length: float = 1, project: bool = False, **extra) -> None:
            start = at(days=day, hours=hour - 9)  # NOW is 09:00 UTC
            row = Event(
                title=title,
                start_time=start,
                end_time=at(days=day, hours=hour - 9 + length),
                project_id=project_row_id if project else None,
                **extra,
            )
            stamp(row, at(-5))
            db.add(row)

        project_row_id = project.id
        event("Team sync", day=-2, hour=10)
        event("Talk outline review", day=-1, hour=14, project=True, location="Room 2B")
        event("Standup", day=0, hour=9.5, length=0.5)
        event("Call with Mina", day=0, hour=16, project=True)
        event("Rehearsal slot", day=1, hour=13, length=2, project=True, location="Big room")
        event("Lunch with the organisers", day=2, hour=12, length=1.5, location="Café Einstein")
        all_day = Event(title="Library books due", start_time=at(days=3, hours=-9), is_all_day=True)
        stamp(all_day, at(-5))
        db.add(all_day)

        # The chat thread the hotel research came from.
        conversation = Conversation(id=CONVERSATION_ID, title="Hotels near the venue", project_id=project.id)
        stamp(conversation, at(hours=-3))
        db.add(conversation)
        # conversations and todos reference each other, so the ORM cannot
        # order these inserts by itself: flush the thread before anything
        # that points at it.
        await db.flush()
        for index, (role, content) in enumerate(
            [
                ("user", "Find three hotels within walking distance of the venue for the Berlin talk."),
                (
                    "assistant",
                    "I'll look for hotels near the venue for April 8–10, compare walking time and price, "
                    "and leave the result for you to review.",
                ),
                ("assistant", HOTEL_RESULT),
                ("user", "Can you also check which of them has a late check-in?"),
            ]
        ):
            message = Message(conversation_id=CONVERSATION_ID, role=role, content=content, message_type="text")
            message.created_at = at(hours=-3 + index * 0.12)
            db.add(message)
        await db.flush()

        async def run_with_review(
            *,
            todo: Todo,
            instruction: str,
            run_status: str,
            review_status: str,
            minutes_ago: int,
            adopted: bool = False,
            review_note: str | None = None,
            conversation_id: str | None = None,
        ) -> None:
            created = at(hours=-minutes_ago / 60)
            task = AgentTask(
                task_type="research",
                instruction=instruction,
                todo_id=todo.id,
                agent_type="research",
                status=run_status,
                progress=100,
                conversation_id=conversation_id,
            )
            task.created_at = created
            task.started_at = created
            db.add(task)
            await db.flush()
            run = AgentRun(
                agent_task_id=task.id,
                attempt=1,
                instruction_snapshot=instruction,
                provider="codex_cli",
                status=run_status,
                project_id=project.id,
                progress=100,
                progress_message="Waiting for review" if run_status == "waiting_review" else "Done",
                result=HOTEL_RESULT,
                result_summary=HOTEL_RESULT[:500],
                is_adopted=adopted,
                started_at=created,
                heartbeat_at=created,
                completed_at=at(hours=-minutes_ago / 60 + 0.1),
            )
            stamp(run, created)
            db.add(run)
            await db.flush()
            review = ReviewItem(
                project_id=project.id,
                subject_type="agent_run",
                subject_id=run.id,
                status=review_status,
                summary=f"Review: {instruction}",
                risk_level="low",
                requested_at=at(hours=-minutes_ago / 60 + 0.1),
                reviewed_at=at(hours=-minutes_ago / 60 + 0.5) if review_status == "approved" else None,
                review_note=review_note,
            )
            stamp(review, at(hours=-minutes_ago / 60 + 0.1))
            db.add(review)

        await run_with_review(
            todo=flights,
            instruction="Find three hotels within walking distance of the venue",
            run_status="waiting_review",
            review_status="pending",
            minutes_ago=40,
            conversation_id=CONVERSATION_ID,
        )
        await run_with_review(
            todo=abstract,
            instruction="Summarize last year's talk feedback into three points",
            run_status="completed",
            review_status="approved",
            minutes_ago=26 * 60,
            adopted=True,
            review_note="Good, used as-is.",
        )
        await db.commit()
    print(f"seeded readme fixture: project {project.id}, conversation {CONVERSATION_ID}")


if __name__ == "__main__":
    asyncio.run(seed())
