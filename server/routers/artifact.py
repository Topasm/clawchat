"""Project artifact and revision endpoints."""

from auth.dependencies import get_current_user
from database import get_db
from fastapi import APIRouter, Depends
from schemas.artifact import (
    ArtifactCreate,
    ArtifactResponse,
    ArtifactRevisionCreate,
    ArtifactRevisionResponse,
)
from services import artifact_service
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed


router = APIRouter()


@router.get("/projects/{project_id}/artifacts", response_model=list[ArtifactResponse])
async def list_project_artifacts(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await artifact_service.list_artifacts(db, project_id)


@router.post(
    "/projects/{project_id}/artifacts",
    response_model=ArtifactResponse,
    status_code=201,
)
async def create_project_artifact(
    project_id: str,
    body: ArtifactCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    artifact = await artifact_service.create_artifact(
        db, project_id=project_id, **body.model_dump()
    )
    await db.commit()
    await db.refresh(artifact)
    await notify_module_data_changed("artifacts")
    return artifact


@router.post(
    "/artifacts/{artifact_id}/revisions",
    response_model=ArtifactRevisionResponse,
    status_code=201,
)
async def propose_artifact_revision(
    artifact_id: str,
    body: ArtifactRevisionCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    revision = await artifact_service.propose_revision(
        db, artifact_id, **body.model_dump()
    )
    await db.commit()
    await db.refresh(revision)
    await notify_module_data_changed("artifacts")
    await notify_module_data_changed("reviews")
    return revision
