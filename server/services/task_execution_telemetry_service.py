"""Build the task execution overlay without duplicating state on Todo rows."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from domain.review import ReviewStatus, ReviewSubjectType
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.artifact import Artifact, ArtifactRevision
from models.review_item import ReviewItem
from models.todo import Todo
from schemas.task_execution_telemetry import TaskExecutionTelemetryResponse


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

    task_ids = sorted(set(latest_runs) | set(latest_artifacts) | set(pending_reviews))
    response: list[TaskExecutionTelemetryResponse] = []
    for task_id in task_ids:
        run = latest_runs.get(task_id)
        artifact = latest_artifacts.get(task_id)
        response.append(
            TaskExecutionTelemetryResponse(
                task_id=task_id,
                latest_run_id=run.run_id if run else None,
                latest_run_status=run.run_status if run else None,
                latest_run_progress=run.run_progress if run else None,
                latest_run_provider=run.run_provider if run else None,
                latest_run_progress_message=run.run_progress_message if run else None,
                latest_run_updated_at=run.run_updated_at if run else None,
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
