"""Which automation fired an agent task, read from the task's payload.

Lives apart from the scheduled-job service so the run and review services can
ask without importing the scheduler (which imports them).
"""

from __future__ import annotations

import json

from models.agent_task import AgentTask
from models.scheduled_job import ScheduledJob
from sqlalchemy.ext.asyncio import AsyncSession


async def scheduled_job_for_task(db: AsyncSession, task: AgentTask) -> ScheduledJob | None:
    """The automation that fired this task, if one did."""
    try:
        payload = json.loads(task.payload_json) if task.payload_json else {}
    except (TypeError, ValueError):
        return None
    job_id = payload.get("scheduled_job_id") if isinstance(payload, dict) else None
    return await db.get(ScheduledJob, job_id) if job_id else None


__all__ = ["scheduled_job_for_task"]
