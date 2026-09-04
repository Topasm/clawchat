"""Build the task execution overlay without duplicating state on Todo rows."""

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.review import ReviewStatus, ReviewSubjectType
from models.agent_run import AgentRun, AgentRunEvent
from models.agent_task import AgentTask
from models.artifact import Artifact, ArtifactRevision
from models.review_item import ReviewItem
from models.todo import Todo
from schemas.task_execution_telemetry import TaskExecutionTelemetryResponse

_HUMAN_WAIT_STARTED = {
    "waiting_input",
    "waiting_permission",
    "waiting_review",
    "changes_requested",
}
_HUMAN_WAIT_ENDED = {
    "resuming",
    "follow_up_sent",
    "permission_allowed",
    "permission_denied",
    "approved",
    "rejected",
    "cancelled",
    "failed",
    "running",
}
_QUESTION_STARTED = {"waiting_input", "waiting_permission"}
_QUESTION_ANSWERED = {
    "resuming",
    "follow_up_sent",
    "permission_allowed",
    "permission_denied",
    "running",
}


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _collaboration_metrics(rows, *, now: datetime) -> dict[str, dict[str, int | None]]:
    """Fold ordered run events into task-level human handoff metrics."""
    by_task: dict[str, list] = defaultdict(list)
    for row in rows:
        by_task[row.task_id].append(row)

    metrics: dict[str, dict[str, int | None]] = {}
    for task_id, events in by_task.items():
        wait_started: dict[str, datetime] = {}
        question_started: dict[str, datetime] = {}
        human_wait_seconds = 0
        resume_durations: list[int] = []
        question_count = 0
        for event in events:
            occurred_at = _aware(event.created_at)
            if event.event_type in _HUMAN_WAIT_STARTED:
                wait_started.setdefault(event.run_id, occurred_at)
            if event.event_type in _QUESTION_STARTED:
                question_count += 1
                question_started[event.run_id] = occurred_at
            if event.event_type in _QUESTION_ANSWERED:
                started = question_started.pop(event.run_id, None)
                if started is not None:
                    resume_durations.append(max(0, int((occurred_at - started).total_seconds())))
            if event.event_type in _HUMAN_WAIT_ENDED:
                started = wait_started.pop(event.run_id, None)
                if started is not None:
                    human_wait_seconds += max(0, int((occurred_at - started).total_seconds()))
        for started in wait_started.values():
            human_wait_seconds += max(0, int((now - started).total_seconds()))
        metrics[task_id] = {
            "human_wait_seconds": human_wait_seconds,
            "question_count": question_count,
            "average_resume_seconds": (
                round(sum(resume_durations) / len(resume_durations))
                if resume_durations
                else None
            ),
        }
    return metrics


async def list_task_execution_telemetry(
    db: AsyncSession,
    *,
    project_id: str | None = None,
) -> list[TaskExecutionTelemetryResponse]:
    """Return one sparse telemetry record for each task with execution activity."""

    run_ranked_query = (
        select(
            AgentTask.todo_id.label("task_id"),
            AgentRun.id.label("run_id"),
            AgentRun.status.label("run_status"),
            AgentRun.progress.label("run_progress"),
            AgentRun.provider.label("run_provider"),
            AgentRun.progress_message.label("run_progress_message"),
            AgentRun.updated_at.label("run_updated_at"),
            func.row_number()
            .over(
                partition_by=AgentTask.todo_id,
                order_by=(
                    AgentRun.created_at.desc(),
                    AgentRun.attempt.desc(),
                    AgentRun.id.desc(),
                ),
            )
            .label("row_number"),
        )
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(AgentTask.todo_id.is_not(None))
    )
    if project_id is not None:
        run_ranked_query = run_ranked_query.join(
            Todo, Todo.id == AgentTask.todo_id
        ).where(Todo.project_id == project_id)
    run_ranked = run_ranked_query.subquery()
    latest_runs = {
        row.task_id: row
        for row in (
            await db.execute(select(run_ranked).where(run_ranked.c.row_number == 1))
        ).mappings()
    }

    event_query = (
        select(
            AgentTask.todo_id.label("task_id"),
            AgentRunEvent.run_id,
            AgentRunEvent.event_type,
            AgentRunEvent.created_at,
        )
        .join(AgentRun, AgentRun.id == AgentRunEvent.run_id)
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(AgentTask.todo_id.is_not(None))
        .order_by(AgentRunEvent.run_id, AgentRunEvent.sequence)
    )
    if project_id is not None:
        event_query = event_query.join(Todo, Todo.id == AgentTask.todo_id).where(
            Todo.project_id == project_id
        )
    collaboration = _collaboration_metrics(
        (await db.execute(event_query)).mappings(),
        now=datetime.now(timezone.utc),
    )

    artifact_ranked_query = (
        select(
            Artifact.task_id.label("task_id"),
            Artifact.id.label("artifact_id"),
            Artifact.title.label("artifact_title"),
            Artifact.type.label("artifact_type"),
            Artifact.updated_at.label("artifact_updated_at"),
            func.count(Artifact.id)
            .over(partition_by=Artifact.task_id)
            .label("artifact_count"),
            func.row_number()
            .over(
                partition_by=Artifact.task_id,
                order_by=(Artifact.updated_at.desc(), Artifact.id.desc()),
            )
            .label("row_number"),
        )
        .where(Artifact.task_id.is_not(None))
    )
    if project_id is not None:
        artifact_ranked_query = artifact_ranked_query.join(
            Todo, Todo.id == Artifact.task_id
        ).where(Todo.project_id == project_id)
    artifact_ranked = artifact_ranked_query.subquery()
    latest_artifacts = {
        row.task_id: row
        for row in (
            await db.execute(
                select(artifact_ranked).where(artifact_ranked.c.row_number == 1)
            )
        ).mappings()
    }

    run_review_query = (
        select(
            AgentTask.todo_id.label("task_id"),
            func.count(ReviewItem.id).label("review_count"),
        )
        .select_from(ReviewItem)
        .join(AgentRun, AgentRun.id == ReviewItem.subject_id)
        .join(AgentTask, AgentTask.id == AgentRun.agent_task_id)
        .where(
            ReviewItem.status == ReviewStatus.PENDING,
            ReviewItem.subject_type == ReviewSubjectType.AGENT_RUN,
            AgentTask.todo_id.is_not(None),
        )
        .group_by(AgentTask.todo_id)
    )
    if project_id is not None:
        run_review_query = run_review_query.join(
            Todo, Todo.id == AgentTask.todo_id
        ).where(Todo.project_id == project_id)
    pending_reviews = {
        row.task_id: row.review_count
        for row in (await db.execute(run_review_query)).mappings()
    }

    revision_review_query = (
        select(
            Artifact.task_id.label("task_id"),
            func.count(ReviewItem.id).label("review_count"),
        )
        .select_from(ReviewItem)
        .join(ArtifactRevision, ArtifactRevision.id == ReviewItem.subject_id)
        .join(Artifact, Artifact.id == ArtifactRevision.artifact_id)
        .where(
            ReviewItem.status == ReviewStatus.PENDING,
            ReviewItem.subject_type == ReviewSubjectType.ARTIFACT_REVISION,
            Artifact.task_id.is_not(None),
        )
        .group_by(Artifact.task_id)
    )
    if project_id is not None:
        revision_review_query = revision_review_query.join(
            Todo, Todo.id == Artifact.task_id
        ).where(Todo.project_id == project_id)
    for row in (await db.execute(revision_review_query)).mappings():
        pending_reviews[row.task_id] = (
            pending_reviews.get(row.task_id, 0) + row.review_count
        )

    task_ids = sorted(
        set(latest_runs) | set(latest_artifacts) | set(pending_reviews) | set(collaboration)
    )
    response: list[TaskExecutionTelemetryResponse] = []
    for task_id in task_ids:
        run = latest_runs.get(task_id)
        artifact = latest_artifacts.get(task_id)
        collaboration_metrics = collaboration.get(task_id, {})
        response.append(
            TaskExecutionTelemetryResponse(
                task_id=task_id,
                latest_run_id=run.run_id if run else None,
                latest_run_status=run.run_status if run else None,
                latest_run_progress=run.run_progress if run else None,
                latest_run_provider=run.run_provider if run else None,
                latest_run_progress_message=run.run_progress_message if run else None,
                latest_run_updated_at=run.run_updated_at if run else None,
                human_wait_seconds=int(
                    collaboration_metrics.get("human_wait_seconds") or 0
                ),
                question_count=int(collaboration_metrics.get("question_count") or 0),
                average_resume_seconds=collaboration_metrics.get(
                    "average_resume_seconds"
                ),
                pending_review_count=pending_reviews.get(task_id, 0),
                artifact_count=artifact.artifact_count if artifact else 0,
                latest_artifact_id=artifact.artifact_id if artifact else None,
                latest_artifact_title=artifact.artifact_title if artifact else None,
                latest_artifact_type=artifact.artifact_type if artifact else None,
                latest_artifact_updated_at=(
                    artifact.artifact_updated_at if artifact else None
                ),
            )
        )
    return response
