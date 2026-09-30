from auth.dependencies import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, Request, Response
from schemas.scheduled_job import (
    ScheduledJobCreate,
    ScheduledJobListResponse,
    ScheduledJobResponse,
    ScheduledJobRunResponse,
    ScheduledJobUpdate,
)
from services.automation import scheduled_job_service
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("", response_model=ScheduledJobListResponse)
async def list_scheduled_jobs(db: AsyncSession = Depends(get_db)):
    jobs = await scheduled_job_service.list_jobs(db)
    return ScheduledJobListResponse(
        jobs=[await scheduled_job_service.build_response(db, job) for job in jobs]
    )


@router.post("", response_model=ScheduledJobResponse, status_code=201)
async def create_scheduled_job(
    body: ScheduledJobCreate, db: AsyncSession = Depends(get_db)
):
    job = await scheduled_job_service.create_job(db, body)
    return await scheduled_job_service.build_response(db, job)


@router.patch("/{job_id}", response_model=ScheduledJobResponse)
async def update_scheduled_job(
    job_id: str, body: ScheduledJobUpdate, db: AsyncSession = Depends(get_db)
):
    job = await scheduled_job_service.update_job(db, job_id, body)
    return await scheduled_job_service.build_response(db, job)


@router.delete("/{job_id}", status_code=204)
async def delete_scheduled_job(job_id: str, db: AsyncSession = Depends(get_db)):
    await scheduled_job_service.delete_job(db, job_id)
    return Response(status_code=204)


@router.post("/{job_id}/run", response_model=ScheduledJobRunResponse, status_code=202)
async def run_scheduled_job_now(
    job_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    """Run the job once now; its regular schedule is unchanged."""
    job = await scheduled_job_service.require_job(db, job_id)
    run = await scheduled_job_service.fire_job(
        db, job, request.app.state, trigger="manual"
    )
    return ScheduledJobRunResponse(run_id=run.id, conversation_id=job.conversation_id)
