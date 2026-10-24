"""Which automation fired an agent task, read from the task's payload.

Lives apart from the scheduled-job service so the run and review services can
ask without importing the scheduler (which imports them).
"""

from __future__ import annotations

import json

from domain.review import ReviewStatus, ReviewSubjectType
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.review_item import ReviewItem
from models.scheduled_job import ScheduledJob
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

#: The review note an automation's auto-approved result carries.
AUTO_APPROVED_NOTE = "Approved automatically: this automation does not ask for low-risk results"

#: How many results in a row the user must approve untouched before the card
#: offers "Don't ask next time". Offered from the first card, the box would be
#: ticked before a single result had been read.
CLEAN_APPROVALS_BEFORE_OFFER = 2


def task_provenance(task: AgentTask) -> str | None:
    """Who started this task without a click: ``scheduled_job``, ``policy`` or None."""
    try:
        payload = json.loads(task.payload_json) if task.payload_json else {}
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("scheduled_job_id"):
        return "scheduled_job"
    provenance = payload.get("provenance")
    return provenance if isinstance(provenance, str) and provenance else None


async def scheduled_job_for_task(db: AsyncSession, task: AgentTask) -> ScheduledJob | None:
    """The automation that fired this task, if one did."""
    try:
        payload = json.loads(task.payload_json) if task.payload_json else {}
    except (TypeError, ValueError):
        return None
    job_id = payload.get("scheduled_job_id") if isinstance(payload, dict) else None
    return await db.get(ScheduledJob, job_id) if job_id else None


async def recent_decisions(db: AsyncSession, job_id: str, limit: int) -> list[ReviewItem]:
    """The job's last ``limit`` decided reviews, newest first."""
    query = (
        select(ReviewItem)
        .join(AgentRun, AgentRun.id == ReviewItem.subject_id)
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(
            ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
            ReviewItem.status != ReviewStatus.PENDING,
            AgentTask.payload_json.like(f'%"scheduled_job_id": "{job_id}"%'),
        )
        .order_by(ReviewItem.reviewed_at.desc(), ReviewItem.id.desc())
        .limit(limit)
    )
    return list((await db.execute(query)).scalars().all())


def is_clean_approval(item: ReviewItem) -> bool:
    """Approved as it came, by a person: no note, no change requested, not automatic."""
    return item.status == ReviewStatus.APPROVED and not (item.review_note or "").strip()


async def offers_skip_review(db: AsyncSession, job: ScheduledJob) -> bool:
    """Whether a result card for this job may show "Don't ask next time".

    Once the job skips review the box stays, so it can be unticked. Before
    that it appears only after the user has approved the last two results
    exactly as they came.
    """
    if job.auto_approve_low_risk:
        return True
    recent = await recent_decisions(db, job.id, CLEAN_APPROVALS_BEFORE_OFFER)
    return len(recent) >= CLEAN_APPROVALS_BEFORE_OFFER and all(
        is_clean_approval(item) for item in recent
    )


__all__ = [
    "AUTO_APPROVED_NOTE",
    "CLEAN_APPROVALS_BEFORE_OFFER",
    "is_clean_approval",
    "offers_skip_review",
    "recent_decisions",
    "scheduled_job_for_task",
    "task_provenance",
]
