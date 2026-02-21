"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """ClawChat server settings.

    All values can be overridden via environment variables or a .env file
    located alongside this module.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # --- Server ---
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # --- Database ---
    DATABASE_URL: str = "sqlite:///./data/clawchat.db"

    # --- Auth ---
    JWT_SECRET: str  # required
    JWT_EXPIRY_HOURS: int = 24
    PIN: str  # required

    # --- AI Provider ---
    AI_PROVIDER: str = "ollama"
    AI_BASE_URL: str = "http://localhost:11434"
    AI_API_KEY: str = ""
    AI_MODEL: str = "llama3.2"

    # --- Scheduler ---
    ENABLE_SCHEDULER: bool = True
    BRIEFING_TIME: str = "08:00"
    REMINDER_CHECK_INTERVAL: int = 60


settings = Settings()
