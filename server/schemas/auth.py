from pydantic import BaseModel


class LoginRequest(BaseModel):
    pin: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    host_id: str | None = None
    host_public_key: str | None = None
    api_version: str = "1"
    workspace_name: str = "ClawChat"


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class WebSocketTicketResponse(BaseModel):
    ticket: str
    expires_in: int
