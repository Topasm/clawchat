import logging
import secrets

from pydantic import field_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/clawchat.db"

    # Authentication
    jwt_secret: str = "change-this-to-a-random-secret-key"
    jwt_expiry_hours: int = 24
    pin: str = "123456"

    # AI Provider — "ollama", "openai", or "claude_code"
    ai_provider: str = "ollama"
    ai_base_url: str = "http://localhost:11434"
    ai_api_key: str = ""
    ai_model: str = "llama3.2"

    # File uploads
    upload_dir: str = "data/uploads"
    max_upload_size_mb: int = 10
    allowed_extensions: str = "jpg,jpeg,png,gif,webp,svg,pdf,txt,md,zip"

    # Public URL override (for reverse proxy deployments)
    public_url: str = ""

    # Obsidian
    obsidian_vault_path: str = ""
    obsidian_cli_command: str = ""

    # Scheduler
    enable_scheduler: bool = False
    briefing_time: str = "08:00"
    reminder_check_interval: int = 5
    debug: bool = False

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "production", "prod"}:
                return False
            if normalized in {"debug", "development", "dev"}:
                return True
        return value

    @field_validator("jwt_secret", mode="before")
    @classmethod
    def autogenerate_jwt_secret(cls, value):
        if value == "change-this-to-a-random-secret-key":
            generated = secrets.token_urlsafe(32)
            logger.warning(
                "JWT_SECRET is using the default placeholder. "
                "Auto-generating a random secret for this session. "
                "Set JWT_SECRET in your .env file for stable sessions."
            )
            return generated
        return value


settings = Settings()
