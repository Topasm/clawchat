"""Unified review inbox and decision endpoint."""

import logging

from auth.dependencies import get_current_user
from database import get_db
from domain.review import ReviewStatus, ReviewSubjectType
from exceptions import ConflictError
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from models.plan_proposal import PlanProposal
from schemas.review import ReviewDecisionRequest, ReviewDecisionResponse, ReviewItemResponse
from schemas.task import PlanApplyRequest
from services import (
    agent_run_service,
    artifact_service,
    plan_proposal_service,
    review_item_service,
    vault_sync_service,
)
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed


router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=list[ReviewItemResponse])
async def list_reviews(
    status: ReviewStatus | None = Query(ReviewStatus.PENDING),
    project_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await review_item_service.list_review_items(
        db, status=status, project_id=project_id
    )


def _schedule_vault_job(
    background_tasks: BackgroundTasks, request: Request, job_id: str | None
) -> None:
    session_factory = getattr(request.app.state, "session_factory", None)
    if job_id is None or session_factory is None:
        return

    async def process() -> None:
        try:
            async with session_factory() as job_db:
                await vault_sync_service.process_vault_sync_job(job_db, job_id)
        except Exception:
            logger.exception("Background Vault sync job %s failed", job_id)

    background_tasks.add_task(process)


@router.post("/{review_id}/decision", response_model=ReviewDecisionResponse)
async def decide_review(
    review_id: str,
    body: ReviewDecisionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    item = await review_item_service.get_review_item(db, review_id)
    if item.status not in {ReviewStatus.PENDING, ReviewStatus.CHANGES_REQUESTED}:
        raise ConflictError(f"Review item cannot be decided from {item.status}")
    item.review_note = body.note
    outcome: dict = {}

    if item.subject_type == ReviewSubjectType.PLAN_PROPOSAL:
        proposal = await db.get(PlanProposal, item.subject_id)
        if proposal is None or proposal.root_task_id is None:
            raise ConflictError("The plan proposal is no longer available")
        if body.decision == ReviewStatus.APPROVED:
            if proposal.base_graph_revision is None:
                raise ConflictError("Legacy plans must be regenerated before review")
            result, job_id = await plan_proposal_service.apply_proposal(
                db,
                proposal.root_task_id,
                PlanApplyRequest(
                    proposal_id=proposal.id,
                    base_graph_revision=proposal.base_graph_revision,
                ),
            )
            outcome = result.model_dump(mode="json")
            _schedule_vault_job(background_tasks, request, job_id)
        elif body.decision == ReviewStatus.REJECTED:
            outcome = await plan_proposal_service.dismiss_proposal(
                db, proposal.root_task_id, proposal.id
            )
        else:
            await review_item_service.set_subject_review_status(
                db, ReviewSubjectType.PLAN_PROPOSAL, proposal.id,
                ReviewStatus.CHANGES_REQUESTED, note=body.note,
            )
            await db.commit()
    elif item.subject_type == ReviewSubjectType.ARTIFACT_REVISION:
        outcome = await artifact_service.decide_revision(
            db, item.subject_id, body.decision
        )
        await review_item_service.set_subject_review_status(
            db, ReviewSubjectType.ARTIFACT_REVISION, item.subject_id,
            body.decision, note=body.note,
        )
        await db.commit()
    elif item.subject_type == ReviewSubjectType.AGENT_RUN:
        outcome = await agent_run_service.decide_run(
            db, item.subject_id, body.decision
        )
        await review_item_service.set_subject_review_status(
            db,
            ReviewSubjectType.AGENT_RUN,
            item.subject_id,
            body.decision,
            note=body.note,
        )
        await db.commit()
    else:
        raise ConflictError(
            f"Review decisions for {item.subject_type} are not supported yet"
        )

    refreshed = await review_item_service.get_review_item(db, review_id)
    response = await review_item_service.build_review_response(db, refreshed)
    await notify_module_data_changed("reviews")
    if item.project_id:
        await notify_module_data_changed("projects")
    if item.subject_type == ReviewSubjectType.PLAN_PROPOSAL:
        await notify_module_data_changed("todos")
    elif item.subject_type == ReviewSubjectType.ARTIFACT_REVISION:
        await notify_module_data_changed("artifacts")
    else:
        await notify_module_data_changed("runs")
        await notify_module_data_changed("todos")
    return ReviewDecisionResponse(review=response, outcome=outcome)
