"""Versioned project artifact commands."""

from datetime import datetime, timezone

from domain.review import (
    ArtifactRevisionStatus,
    ArtifactType,
    ReviewRiskLevel,
    ReviewStatus,
    ReviewSubjectType,
)
from exceptions import ConflictError, NotFoundError, ValidationError
from models.artifact import Artifact, ArtifactRevision
from models.project import Project
from models.todo import Todo
from services import review_item_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from utils import make_id


async def list_artifacts(db: AsyncSession, project_id: str) -> list[Artifact]:
    if await db.get(Project, project_id) is None:
        raise NotFoundError("Project not found")
    return list((await db.execute(
        select(Artifact).where(Artifact.project_id == project_id).order_by(
            Artifact.updated_at.desc(), Artifact.id.asc()
        )
    )).scalars().all())


async def create_artifact(
    db: AsyncSession,
    *,
    project_id: str,
    type: ArtifactType,
    title: str,
    content: str,
    task_id: str | None,
    source: str,
    created_by: str | None,
) -> Artifact:
    if await db.get(Project, project_id) is None:
        raise NotFoundError("Project not found")
    if task_id:
        task = await db.get(Todo, task_id)
        if task is None or task.project_id != project_id:
            raise ValidationError("Artifact task must belong to the project")
    artifact = Artifact(
        id=make_id("artifact_"), project_id=project_id, task_id=task_id,
        type=type, title=title, content=content, current_version=1,
        source=source, created_by=created_by,
    )
    revision = ArtifactRevision(
        id=make_id("revision_"), artifact_id=artifact.id, version=1,
        title=title, content=content, source=source, created_by=created_by,
        status=ArtifactRevisionStatus.APPROVED,
        reviewed_at=datetime.now(timezone.utc),
    )
    db.add_all([artifact, revision])
    await db.flush()
    return artifact


async def propose_revision(
    db: AsyncSession,
    artifact_id: str,
    *,
    title: str | None,
    content: str,
    source: str,
    created_by: str | None,
    summary: str | None,
) -> ArtifactRevision:
    artifact = await db.get(Artifact, artifact_id)
    if artifact is None:
        raise NotFoundError("Artifact not found")
    pending = (await db.execute(select(ArtifactRevision).where(
        ArtifactRevision.artifact_id == artifact.id,
        ArtifactRevision.status.in_([
            ArtifactRevisionStatus.PENDING,
            ArtifactRevisionStatus.CHANGES_REQUESTED,
        ]),
    ))).scalar_one_or_none()
    if pending is not None and pending.status == ArtifactRevisionStatus.PENDING:
        raise ConflictError("This artifact already has a revision awaiting review")
    if pending is not None:
        revision = pending
        revision.title = title or artifact.title
        revision.content = content
        revision.source = source
        revision.created_by = created_by
        revision.status = ArtifactRevisionStatus.PENDING
        revision.reviewed_at = None
    else:
        revision = ArtifactRevision(
            id=make_id("revision_"), artifact_id=artifact.id,
            version=artifact.current_version + 1, title=title or artifact.title,
            content=content, source=source, created_by=created_by,
            status=ArtifactRevisionStatus.PENDING,
        )
        db.add(revision)
    await db.flush()
    review_item = await review_item_service.ensure_review_item(
        db,
        subject_type=ReviewSubjectType.ARTIFACT_REVISION,
        subject_id=revision.id,
        project_id=artifact.project_id,
        summary=summary or f"Review changes to {artifact.title}",
        risk_level=ReviewRiskLevel.LOW,
    )
    review_item.status = ReviewStatus.PENDING
    review_item.requested_at = datetime.now(timezone.utc)
    review_item.reviewed_at = None
    review_item.review_note = None
    return revision


async def decide_revision(
    db: AsyncSession,
    revision_id: str,
    decision: ReviewStatus,
) -> dict:
    revision = await db.get(ArtifactRevision, revision_id)
    if revision is None:
        raise NotFoundError("Artifact revision not found")
    artifact = await db.get(Artifact, revision.artifact_id)
    if artifact is None:
        raise NotFoundError("Artifact not found")
    if revision.status not in {
        ArtifactRevisionStatus.PENDING,
        ArtifactRevisionStatus.CHANGES_REQUESTED,
    }:
        raise ConflictError(f"Artifact revision cannot be reviewed from {revision.status}")
    if decision == ReviewStatus.APPROVED:
        if revision.version != artifact.current_version + 1:
            raise ConflictError("Artifact changed after this revision was proposed")
        artifact.title = revision.title
        artifact.content = revision.content
        artifact.current_version = revision.version
        artifact.source = revision.source
        revision.status = ArtifactRevisionStatus.APPROVED
    elif decision == ReviewStatus.CHANGES_REQUESTED:
        revision.status = ArtifactRevisionStatus.CHANGES_REQUESTED
    elif decision == ReviewStatus.REJECTED:
        revision.status = ArtifactRevisionStatus.REJECTED
    else:
        raise ValidationError("Unsupported review decision")
    revision.reviewed_at = datetime.now(timezone.utc)
    await db.flush()
    return {
        "artifact_id": artifact.id,
        "revision_id": revision.id,
        "version": revision.version,
        "artifact_updated": decision == ReviewStatus.APPROVED,
    }
