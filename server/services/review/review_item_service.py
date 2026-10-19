"""Shared review queue persistence and enriched read models."""

import json
from datetime import datetime, timezone
from typing import Any

from domain.plan_proposal import PlanProposalStatus
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
from services.automation.job_provenance import (
    AUTO_APPROVED_NOTE,
    offers_skip_review,
    scheduled_job_for_task,
)
from services.review import agent_review_handoff_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id


#: How many changed paths a review card lists; the count says the rest.
CHANGED_FILES_SHOWN = 20


def run_changed_files(run: AgentRun) -> list[dict[str, Any]] | None:
    """The files a run changed, as its executor recorded them, or None when unknown.

    Only executors that diff their workspace (OpenCode) write ``usage.files``;
    for the rest the card stays silent rather than claiming "no changes".
    """
    try:
        usage = json.loads(run.usage_json or "null")
    except (TypeError, ValueError):
        return None
    files = usage.get("files") if isinstance(usage, dict) else None
    if not isinstance(files, list):
        return None
    changed = []
    for item in files:
        if not isinstance(item, dict) or not item.get("file"):
            continue
        changed.append(
            {
                "path": str(item["file"]),
                "status": str(item.get("status") or "modified"),
                "additions": item.get("additions"),
                "deletions": item.get("deletions"),
            }
        )
    return changed


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


_LEGACY_PLAN_SUMMARY = "Review AI plan for "

#: Proposals still waiting on a person; anything later is already settled.
_OPEN_PROPOSAL_STATUSES = (PlanProposalStatus.DRAFT, PlanProposalStatus.STALE)


async def close_task_plan_reviews(db: AsyncSession, todo_ids: list[str] | set[str]) -> int:
    """Expire plan reviews of tasks that are done, deleted or now notes.

    A plan for a finished or vanished task is nothing left to decide, so its
    card leaves the review queue instead of waiting there. Call this before a
    delete: the proposal loses its root link once the task row is gone.
    """
    ids = [todo_id for todo_id in todo_ids if todo_id]
    if not ids:
        return 0
    proposals = list(
        (
            await db.execute(
                select(PlanProposal).where(
                    PlanProposal.root_task_id.in_(ids),
                    PlanProposal.status.in_(_OPEN_PROPOSAL_STATUSES),
                )
            )
        ).scalars()
    )
    if not proposals:
        return 0
    for proposal in proposals:
        proposal.status = PlanProposalStatus.STALE
    items = list(
        (
            await db.execute(
                select(ReviewItem).where(
                    ReviewItem.subject_type == ReviewSubjectType.PLAN_PROPOSAL,
                    ReviewItem.subject_id.in_([proposal.id for proposal in proposals]),
                    ReviewItem.status == ReviewStatus.PENDING,
                )
            )
        ).scalars()
    )
    now = datetime.now(timezone.utc)
    for item in items:
        item.status = ReviewStatus.EXPIRED
        item.reviewed_at = now
    return len(items)


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
        title = root.title if root else None
        # The client words the card in the reader's language.
        description = None
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
                else f"/attention?view=runs&run_id={run.id}"
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
            changed = run_changed_files(run)
            if changed is not None:
                metadata["changed_files"] = changed[:CHANGED_FILES_SHOWN]
                metadata["changed_files_count"] = len(changed)
            job = await scheduled_job_for_task(db, task)
            if job is not None:
                # The card offers "don't ask next time" right where the result
                # is -- but only for a result that could not have changed
                # anything, and only once two results in a row were approved
                # untouched. Today lists the results that skipped the queue.
                metadata["automation"] = {
                    "scheduled_job_id": job.id,
                    "title": job.title,
                    "auto_approve_low_risk": bool(job.auto_approve_low_risk),
                    "offer_skip_review": (
                        item.risk_level == ReviewRiskLevel.LOW
                        and await offers_skip_review(db, job)
                    ),
                    "auto_approved": item.review_note == AUTO_APPROVED_NOTE,
                }
    elif item.subject_type == ReviewSubjectType.DATA_SOURCE_WRITE:
        from services.data_sources import service as data_source_service

        described = await data_source_service.describe_write(db, item.subject_id)
        if described is not None:
            title, description, metadata = described
    summary = item.summary
    if title and summary.startswith(_LEGACY_PLAN_SUMMARY):
        # Older plan reviews stored an English sentence; the task name says it.
        summary = title
    return ReviewItemResponse(
        **{
            column: getattr(item, column)
            for column in (
                "id", "project_id", "subject_type", "subject_id", "status",
                "risk_level", "requested_at", "reviewed_at", "review_note",
            )
        },
        summary=summary,
        project_title=project.title if project else None,
        subject_title=title,
        subject_description=description,
        subject_href=href,
        metadata=metadata,
    )
