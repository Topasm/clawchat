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

    # Brute-force protection for the unauthenticated credential endpoints
    # (PIN login and pairing claim). Failures only -- a successful login
    # clears the caller's counter.
    rate_limit_enabled: bool = True
    login_max_failures: int = 5
    login_failure_window_seconds: int = 300
    login_lockout_seconds: int = 60
    pairing_max_failures: int = 5
    pairing_failure_window_seconds: int = 300
    pairing_lockout_seconds: int = 60
    # Honour X-Forwarded-For when the server sits behind a reverse proxy you
    # control. Leave false on a directly exposed server: an untrusted client
    # can spoof the header and bypass throttling.
    trust_proxy_headers: bool = False

    # CORS. Comma-separated origins, or "*" to allow any (development only --
    # a wildcard lets any website in the browser call this server's API).
    cors_allow_origins: str = ""

    # AI Provider — "ollama", "openai", or "claude_code"
    ai_provider: str = "ollama"
    ai_base_url: str = "http://localhost:11434"
    ai_api_key: str = ""
    ai_model: str = "llama3.2"

    # Optional Paseo execution daemon. The CLI owns daemon authentication and
    # supports local, TCP, unix-socket, and E2EE offer URL targets.
    paseo_enabled: bool = False
    paseo_cli_command: str = "paseo"
    paseo_host: str = ""
    paseo_default_provider: str = "codex"
    paseo_poll_interval_seconds: float = 3.0
    paseo_command_timeout_seconds: float = 30.0
    paseo_reconnect_grace_seconds: float = 120.0

    # File uploads
    upload_dir: str = "data/uploads"
    max_upload_size_mb: int = 10
    allowed_extensions: str = "jpg,jpeg,png,gif,webp,svg,pdf,txt,md,zip"

    # Public URL override (for reverse proxy deployments)
    public_url: str = ""

    # Optional E2EE relay for port-forwarding-free remote access
    relay_url: str = ""

    # Obsidian
    obsidian_vault_path: str = ""
    obsidian_cli_command: str = ""
    obsidian_sync_mode: str = "filesystem"  # "livesync", "filesystem", or "disabled"
    obsidian_project_todo_filename: str = "TODO.md"
    obsidian_companion_node_required: bool = False
    obsidian_scan_interval_minutes: int = 5
    obsidian_watch_enabled: bool = False  # opt-in: event watcher with polling fallback

    # Push notifications (FCM)
    firebase_credentials_path: str = ""

    # Voice input
    voice_provider: str = "browser"  # "browser" (client-side) or "whisper_api"
    whisper_api_key: str = ""

    # Scheduler
    enable_scheduler: bool = False
    briefing_time: str = "08:00"
    reminder_check_interval: int = 5

    # Proactive nudges
    enable_nudges: bool = False
    nudge_interval_hours: int = 4
    nudge_quiet_hours: str = "22:00-07:00"

    # Weekly review
    enable_weekly_review: bool = False
    weekly_review_day: str = "sunday"
    weekly_review_time: str = "09:00"

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

    def resolved_cors_origins(self) -> list[str]:
        """Return the CORS allowlist, defaulting to local development hosts.

        An empty setting means "no explicit allowlist configured": fall back to
        the local dev origins plus PUBLIC_URL when one is set, rather than to a
        wildcard. Set CORS_ALLOW_ORIGINS="*" to opt into the permissive mode.
        """
        raw = self.cors_allow_origins.strip()
        if raw == "*":
            return ["*"]
        if raw:
            return [origin.strip() for origin in raw.split(",") if origin.strip()]

        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "tauri://localhost",
            "http://localhost",
        ]
        if self.public_url:
            public = self.public_url.rstrip("/")
            if public not in origins:
                origins.append(public)
        return origins


settings = Settings()
