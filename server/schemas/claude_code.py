from typing import Optional

from pydantic import BaseModel


class ClaudeCodeStatusResponse(BaseModel):
    status: str  # available, not_installed, not_authenticated, busy, error
    version: Optional[str] = None
    message: Optional[str] = None
