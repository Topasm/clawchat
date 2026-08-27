"""Undo endpoint for versioned plan change sets."""

import logging

from auth.dependencies import get_current_user
from database import get_db
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from schemas.common import ErrorResponse
from schemas.task import PlanUndoResponse
from services import plan_proposal_service, vault_sync_service
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/{change_set_id}/revert",
    response_model=PlanUndoResponse,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def revert_change_set(
    change_set_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
) -> PlanUndoResponse:
    response, job_id = await plan_proposal_service.revert_change_set(
        db,
        change_set_id,
    )
    if job_id is not None:
        session_factory = getattr(request.app.state, "session_factory", None)

        if session_factory is not None:

            async def _process() -> None:
                try:
                    async with session_factory() as job_db:
                        await vault_sync_service.process_vault_sync_job(job_db, job_id)
                except Exception:
                    logger.exception("Background Vault sync job %s failed", job_id)

            background_tasks.add_task(_process)
        else:
            logger.warning(
                "Vault sync job %s remains pending: no session factory",
                job_id,
            )
    await notify_module_data_changed("todos")
    return response
