"""Shared review queue persistence and enriched read models."""

from datetime import datetime, timezone

from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType
from exceptions import NotFoundError
from models.artifact import Artifact, ArtifactRevision
from models.agent_run import AgentRun
from models.agent_task import AgentTask
from models.plan_proposal import PlanProposal
from models.project import Project
from models.review_item import ReviewItem
from models.todo import Todo
from schemas.review import ReviewItemResponse
from services.review import agent_review_handoff_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id


async def ensure_review_item(
    db: AsyncSession,
    *,
    subject_type: ReviewSubjectType,
    subject_id: str,
    project_id: str | None,
    summary: str,
    risk_level: ReviewRiskLevel = ReviewRiskLevel.MEDIUM,
) -> ReviewItem:
    item = (
        await db.execute(
            select(ReviewItem).where(
                ReviewItem.subject_type == subject_type,
                ReviewItem.subject_id == subject_id,
            )
        )
    ).scalar_one_or_none()
    if item is None:
        item = ReviewItem(
            id=make_id("review_"),
            project_id=project_id,
            subject_type=subject_type,
            subject_id=subject_id,
            summary=summary,
            risk_level=risk_level,
        )
        db.add(item)
    else:
        item.project_id = project_id
        item.summary = summary
        item.risk_level = risk_level
    return item


async def set_subject_review_status(
    db: AsyncSession,
    subject_type: ReviewSubjectType,
    subject_id: str,
    status: ReviewStatus,
    *,
    note: str | None = None,
) -> ReviewItem | None:
    item = (
        await db.execute(
            select(ReviewItem).where(
                ReviewItem.subject_type == subject_type,
                ReviewItem.subject_id == subject_id,
            )
        )
    ).scalar_one_or_none()
    if item is None:
        return None
    item.status = status
    if note is not None:
        item.review_note = note
    item.reviewed_at = (
        None if status == ReviewStatus.PENDING else datetime.now(timezone.utc)
    )
    return item


async def get_review_item(db: AsyncSession, review_id: str) -> ReviewItem:
    item = await db.get(ReviewItem, review_id)
    if item is None:
        raise NotFoundError("Review item not found")
    return item


async def list_review_items(
    db: AsyncSession,
    *,
    status: ReviewStatus | None = ReviewStatus.PENDING,
    project_id: str | None = None,
) -> list[ReviewItemResponse]:
    query = select(ReviewItem).order_by(
        ReviewItem.requested_at.desc(), ReviewItem.id.asc()
    )
    if status is not None:
        query = query.where(ReviewItem.status == status)
    if project_id is not None:
        query = query.where(ReviewItem.project_id == project_id)
    items = list((await db.execute(query)).scalars().all())
    return [await build_review_response(db, item) for item in items]


async def build_review_response(
    db: AsyncSession, item: ReviewItem
) -> ReviewItemResponse:
    project = await db.get(Project, item.project_id) if item.project_id else None
    title = None
    description = None
    href = None
    metadata: dict = {}
    if item.subject_type == ReviewSubjectType.PLAN_PROPOSAL:
        proposal = await db.get(PlanProposal, item.subject_id)
        root = (
            await db.get(Todo, proposal.root_task_id)
            if proposal and proposal.root_task_id
            else None
        )
        title = root.title if root else "AI task plan"
        description = "Review the proposed tasks and dependencies before applying."
        href = f"/tasks/{root.id}" if root else None
        if proposal:
            metadata = {
                "proposal_id": proposal.id,
                "todo_id": proposal.root_task_id,
                "base_graph_revision": proposal.base_graph_revision,
                "proposal_status": proposal.status,
            }
    elif item.subject_type == ReviewSubjectType.ARTIFACT_REVISION:
        revision = await db.get(ArtifactRevision, item.subject_id)
        artifact = await db.get(Artifact, revision.artifact_id) if revision else None
        if revision and artifact:
            title = f"{artifact.title} · version {revision.version}"
            description = revision.content[:500]
            href = f"/projects/{artifact.project_id}?section=artifacts"
            metadata = {
                "artifact_id": artifact.id,
                "artifact_type": artifact.type,
                "revision_version": revision.version,
                "current_version": artifact.current_version,
            }
    elif item.subject_type == ReviewSubjectType.AGENT_RUN:
        run = await db.get(AgentRun, item.subject_id)
        task = await db.get(AgentTask, run.agent_task_id) if run else None
        todo = await db.get(Todo, task.todo_id) if task and task.todo_id else None
        if run and task:
            title = todo.title if todo else task.instruction[:120]
            description = run.result_summary
            # The thread holds the whole story; the run page is the fallback.
            href = (
                f"/chats/{task.conversation_id}"
                if task.conversation_id
                else f"/runs?run_id={run.id}"
            )
            approval_impact = (
                await agent_review_handoff_service.build_approval_impact(db, todo)
            )
            metadata = {
                "run_id": run.id,
                "agent_task_id": task.id,
                "conversation_id": task.conversation_id,
                "attempt": run.attempt,
                "provider": run.provider,
                "run_status": run.status,
                "approval_impact": approval_impact.model_dump(mode="json"),
            }
    return ReviewItemResponse(
        **{
            column: getattr(item, column)
            for column in (
                "id", "project_id", "subject_type", "subject_id", "status",
                "summary", "risk_level", "requested_at", "reviewed_at", "review_note",
            )
        },
        project_title=project.title if project else None,
        subject_title=title,
        subject_description=description,
        subject_href=href,
        metadata=metadata,
    )
