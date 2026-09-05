import hashlib
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert

from domain.task import TaskStatus
from exceptions import ConflictError, NotFoundError, ValidationError
from models.inbox_review import InboxPreviewCache, InboxReviewPreference
from models.project import Project
from models.todo import Todo
from schemas.inbox_review import InboxReviewItem, InboxReviewState, InboxReviewUpdate
from schemas.inbox_triage import InboxTriagePreviewResponse
from services.tasks.graph_command_service import (
    claim_graph_revision,
    current_graph_revision,
)


async def read_state(db, owner: str) -> InboxReviewState:
    rows = (
        await db.execute(
            select(InboxReviewPreference)
            .join(Todo)
            .where(
                InboxReviewPreference.owner == owner,
                Todo.inbox_state == "captured",
                Todo.status == TaskStatus.PENDING,
            )
        )
    ).scalars()
    return InboxReviewState(
        items=[
            InboxReviewItem(
                task_id=row.task_id,
                deferred=row.deferred,
                exclude_deadline=row.exclude_deadline,
                choice=json.loads(row.choice_json) if row.choice_json else None,
                choice_revision=row.choice_revision,
            )
            for row in rows
        ]
    )


async def save_preference(db, owner: str, task_id: str, body: InboxReviewUpdate):
    task = await db.get(Todo, task_id)
    if task is None:
        raise NotFoundError("Inbox task not found")
    if task.inbox_state != "captured" or task.status != TaskStatus.PENDING:
        raise ConflictError("Task is no longer awaiting Inbox review")
    values = {
        key: value
        for key in ("deferred", "exclude_deadline")
        if (value := getattr(body, key)) is not None
    }
    if body.choice is not None:
        await claim_graph_revision(db, body.expected_graph_revision)
        choice = body.choice
        if (
            choice.project_id is not None
            and await db.get(Project, choice.project_id) is None
        ):
            raise NotFoundError("Project not found")
        if choice.parent_id is not None:
            parent = await db.get(Todo, choice.parent_id)
            if (
                parent is None
                or parent.project_id != choice.project_id
                or parent.id == task_id
            ):
                raise ValidationError("Invalid parent location")
        values.update(
            choice_json=choice.model_dump_json(),
            choice_revision=body.expected_graph_revision,
        )
    if values:
        await db.execute(
            insert(InboxReviewPreference)
            .values(owner=owner, task_id=task_id, **values)
            .on_conflict_do_update(index_elements=["owner", "task_id"], set_=values)
        )


async def resume_deferred(db, owner: str):
    await db.execute(
        update(InboxReviewPreference)
        .where(InboxReviewPreference.owner == owner)
        .values(deferred=False)
    )


async def cache_key(db, owner: str, body) -> str:
    current = await current_graph_revision(db)
    if body.expected_graph_revision != current:
        raise ConflictError("Task graph changed; refresh suggestions")
    # Include prompt content that can change outside graph revision triggers.
    tasks = (
        await db.execute(
            select(
                Todo.id,
                Todo.title,
                Todo.description,
                Todo.due_date,
                Todo.status,
                Todo.inbox_state,
                Todo.updated_at,
            ).order_by(Todo.id)
        )
    ).all()
    projects = (
        await db.execute(
            select(
                Project.id,
                Project.title,
                Project.goal,
                Project.description,
                Project.status,
                Project.updated_at,
            ).order_by(Project.id)
        )
    ).all()
    content = json.dumps(
        [
            "local-deadline-v1",
            body.model_dump(),
            [list(row) for row in tasks],
            [list(row) for row in projects],
        ],
        default=str,
        sort_keys=True,
    )
    return hashlib.sha256(content.encode()).hexdigest()


async def load_preview(db, owner: str, key: str):
    cached = await db.get(InboxPreviewCache, (owner, key))
    if cached is None:
        return None
    preview = InboxTriagePreviewResponse.model_validate_json(cached.payload)
    # "Past" is display-time state, not a permanently cached flag.
    now = datetime.now(timezone.utc)
    for deadline in preview.deadlines:
        due = deadline.due_date
        deadline.is_past = (
            due if due.tzinfo else due.replace(tzinfo=ZoneInfo(deadline.timezone))
        ) < now
    return preview


async def store_preview(db, owner: str, key: str, preview):
    if await current_graph_revision(db) != preview.base_graph_revision:
        raise ConflictError("Task graph changed while generating suggestions")
    # Bound storage to one revision and at most eight batches per account.
    await db.execute(
        delete(InboxPreviewCache).where(
            InboxPreviewCache.owner == owner,
            InboxPreviewCache.revision != preview.base_graph_revision,
        )
    )
    keys = list(
        (
            await db.execute(
                select(InboxPreviewCache.cache_key)
                .where(InboxPreviewCache.owner == owner)
                .order_by(InboxPreviewCache.cache_key)
            )
        ).scalars()
    )
    if key not in keys and len(keys) >= 8:
        await db.execute(
            delete(InboxPreviewCache).where(
                InboxPreviewCache.owner == owner,
                InboxPreviewCache.cache_key.in_(keys[: len(keys) - 7]),
            )
        )
    await db.execute(
        insert(InboxPreviewCache)
        .values(
            owner=owner,
            cache_key=key,
            revision=preview.base_graph_revision,
            payload=preview.model_dump_json(),
        )
        .on_conflict_do_nothing(index_elements=["owner", "cache_key"])
    )
