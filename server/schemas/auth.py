"""Pydantic schemas for authentication endpoints."""

from pydantic import BaseModel


class LoginRequest(BaseModel):
    pin: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class LogoutResponse(BaseModel):
    detail: str = "Logged out successfully"
