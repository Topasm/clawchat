"""First-class Project endpoints."""

from auth.dependencies import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, Query
from schemas.project import (
    ProjectCreate,
    ProjectOverviewResponse,
    ProjectResponse,
    ProjectUpdate,
)
from services import project_service
from sqlalchemy.ext.asyncio import AsyncSession
from ws.notifications import notify_module_data_changed


router = APIRouter()


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    return await project_service.list_projects(
        db,
        include_archived=include_archived,
    )


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await project_service.create_project(db, **body.model_dump())
    await db.commit()
    await db.refresh(project)
    await notify_module_data_changed("projects")
    await notify_module_data_changed("todos")
    return await project_service.build_project_response(db, project)


@router.get("/{project_id}", response_model=ProjectOverviewResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id)
    return await project_service.build_project_overview(db, project)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    project = await project_service.update_project(
        db,
        project_id,
        **body.model_dump(exclude_unset=True),
    )
    await db.commit()
    await db.refresh(project)
    await notify_module_data_changed("projects")
    await notify_module_data_changed("todos")
    return await project_service.build_project_response(db, project)
