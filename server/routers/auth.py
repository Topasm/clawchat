import uuid
from datetime import datetime, timezone

from auth.dependencies import AuthPrincipal, get_current_principal
from auth.jwt import (
    create_access_token,
    create_refresh_token,
    create_refresh_token_id,
    create_websocket_ticket,
    decode_token,
    hash_refresh_token_id,
    verify_pin,
)
from database import get_db
from exceptions import UnauthorizedError
from fastapi import APIRouter, Depends
from models.refresh_session import RefreshSession
from schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    TokenResponse,
    WebSocketTicketResponse,
)
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    if not verify_pin(body.pin):
        raise UnauthorizedError("Invalid PIN")
    session_id = str(uuid.uuid4())
    token_id = create_refresh_token_id()
    refresh_token = create_refresh_token(
        session_id=session_id,
        token_id=token_id,
    )
    refresh_payload = decode_token(refresh_token, expected_type="refresh")
    db.add(
        RefreshSession(
            id=session_id,
            subject="user",
            current_jti_hash=hash_refresh_token_id(token_id),
            expires_at=datetime.fromtimestamp(refresh_payload["exp"], tz=timezone.utc),
        )
    )
    await db.commit()
    access_token, expires_in = create_access_token(session_id=session_id)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token, expected_type="refresh")
    session_id, token_id, subject = _refresh_claims(payload)
    now = datetime.now(timezone.utc)
    next_token_id = create_refresh_token_id()
    refresh_token = create_refresh_token(
        subject=subject,
        session_id=session_id,
        token_id=next_token_id,
    )
    refresh_payload = decode_token(refresh_token, expected_type="refresh")

    result = await db.execute(
        update(RefreshSession)
        .where(
            RefreshSession.id == session_id,
            RefreshSession.subject == subject,
            RefreshSession.current_jti_hash == hash_refresh_token_id(token_id),
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now,
        )
        .values(
            current_jti_hash=hash_refresh_token_id(next_token_id),
            last_used_at=now,
            expires_at=datetime.fromtimestamp(refresh_payload["exp"], tz=timezone.utc),
        )
    )
    if result.rowcount != 1:
        await _reject_invalid_or_reused_refresh(
            db,
            session_id=session_id,
            subject=subject,
            presented_jti_hash=hash_refresh_token_id(token_id),
            now=now,
        )

    await db.commit()
    access_token, expires_in = create_access_token(
        subject=subject,
        session_id=session_id,
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
    )


@router.post("/logout")
async def logout(
    body: LogoutRequest | None = None,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    session_id = principal.session_id
    if body and body.refresh_token:
        payload = decode_token(body.refresh_token, expected_type="refresh")
        token_session_id, _, token_subject = _refresh_claims(payload)
        if token_subject != principal.subject:
            raise UnauthorizedError("Refresh token belongs to another subject")
        session_id = token_session_id

    if session_id is not None:
        await db.execute(
            update(RefreshSession)
            .where(
                RefreshSession.id == session_id,
                RefreshSession.subject == principal.subject,
                RefreshSession.revoked_at.is_(None),
            )
            .values(
                revoked_at=datetime.now(timezone.utc),
                revocation_reason="logout",
            )
        )
        await db.commit()
    return {"message": "Logged out successfully"}


def _refresh_claims(payload: dict) -> tuple[str, str, str]:
    session_id = payload.get("sid")
    token_id = payload.get("jti")
    subject = payload.get("sub")
    if not all(
        isinstance(value, str) and value for value in (session_id, token_id, subject)
    ):
        raise UnauthorizedError("Invalid refresh token claims")
    return session_id, token_id, subject


async def _reject_invalid_or_reused_refresh(
    db: AsyncSession,
    *,
    session_id: str,
    subject: str,
    presented_jti_hash: str,
    now: datetime,
) -> None:
    result = await db.execute(
        select(RefreshSession).where(
            RefreshSession.id == session_id,
            RefreshSession.subject == subject,
            RefreshSession.expires_at > now,
        )
    )
    session = result.scalar_one_or_none()
    if (
        session is not None
        and session.revoked_at is None
        and session.current_jti_hash != presented_jti_hash
    ):
        session.revoked_at = now
        session.revocation_reason = "token_reuse"
        await db.commit()
        raise UnauthorizedError("Refresh token reuse detected; session revoked")

    await db.rollback()
    raise UnauthorizedError("Refresh session is invalid, expired, or revoked")


@router.post("/ws-ticket", response_model=WebSocketTicketResponse)
async def websocket_ticket(
    principal: AuthPrincipal = Depends(get_current_principal),
):
    ticket, expires_in = create_websocket_ticket(
        subject=principal.subject,
        principal_type=principal.token_type,
    )
    return WebSocketTicketResponse(ticket=ticket, expires_in=expires_in)
