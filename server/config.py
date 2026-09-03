import logging
import os
import secrets
import tempfile
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

_DEFAULT_JWT_SECRET = "change-this-to-a-random-secret-key"


def _read_secret(path: Path) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, encoding="utf-8") as secret_file:
        secret = secret_file.read().strip()
    if len(secret) < 32:
        raise ValueError(f"Secret file {path} is empty or too short")
    return secret


def _load_or_create_secret(path_value: str) -> str:
    path = Path(path_value).expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        secret = _read_secret(path)
    except FileNotFoundError:
        secret = secrets.token_urlsafe(32)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags, 0o600)
        except FileExistsError:
            # Another process won the first-start race. Its completed value is
            # the shared secret both processes must use.
            return _read_secret(path)
        with os.fdopen(descriptor, "w", encoding="utf-8") as secret_file:
            secret_file.write(secret)
            secret_file.flush()
            os.fsync(secret_file.fileno())
    if os.name == "posix":
        os.chmod(path, 0o600)
    return secret


def _read_codex_api_key(path_value: str) -> str:
    path = Path(path_value).expanduser()
    try:
        api_key = _read_secret(path)
    except FileNotFoundError:
        return ""
    except ValueError as error:
        logger.warning("Ignoring invalid Codex API key file %s: %s", path, error)
        return ""
    return api_key


def save_codex_api_key(path_value: str, api_key: str) -> None:
    """Atomically persist a Codex credential in an owner-only file."""
    path = Path(path_value).expanduser()
    value = api_key.strip()
    if len(value) < 32:
        raise ValueError("Codex API key is empty or too short")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        if os.name == "posix":
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as secret_file:
            secret_file.write(value)
            secret_file.flush()
            os.fsync(secret_file.fileno())
        os.replace(temporary_path, path)
        if os.name == "posix":
            os.chmod(path, 0o600)
    finally:
        temporary_path.unlink(missing_ok=True)


# Providers that may be stored as an in-app choice. The relay is recorded
# under its own name so the stored value stays readable regardless of which
# OpenAI-compatible gateway AI_BASE_URL points at.
AI_PROVIDERS = ("openclaw", "claude_code", "codex_cli", "codex")


def _read_ai_provider(path_value: str) -> str:
    """Return the provider persisted from an in-app switch, if any."""
    path = Path(path_value).expanduser()
    try:
        stored = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""
    except OSError as error:
        logger.warning("Could not read the stored AI provider %s: %s", path, error)
        return ""
    if stored not in AI_PROVIDERS:
        if stored:
            logger.warning("Ignoring unknown stored AI provider %r", stored)
        return ""
    return stored


def save_ai_provider(path_value: str, provider: str) -> None:
    """Atomically persist the provider chosen in the app."""
    if provider not in AI_PROVIDERS:
        raise ValueError(f"Unknown AI provider: {provider}")
    path = Path(path_value).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as provider_file:
            provider_file.write(provider)
            provider_file.flush()
            os.fsync(provider_file.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


class Settings(BaseSettings):
    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/clawchat.db"

    # Authentication
    jwt_secret: str = _DEFAULT_JWT_SECRET
    jwt_secret_file: str = ""
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

    # AI Provider — OpenClaw/OpenAI-compatible, local CLIs, or Codex API
    ai_provider: str = "ollama"
    # Remembers the provider picked in the app's settings screen so a restart
    # keeps it. Empty disables persistence, leaving AI_PROVIDER authoritative.
    ai_provider_file: str = ""
    # When the configured provider is unreachable at startup, activate any
    # other provider that is ready instead of leaving chat dead. Set false to
    # keep a deployment pinned to its configured backend.
    ai_provider_fallback: bool = True
    ai_base_url: str = "http://localhost:11434"
    ai_api_key: str = ""
    ai_model: str = "llama3.2"

    # OpenAI Codex via the Responses API. CODEX_API_KEY takes precedence;
    # OPENAI_API_KEY is accepted as the conventional fallback. The desktop
    # shell supplies CODEX_API_KEY_FILE inside its protected app-data folder.
    codex_api_base_url: str = "https://api.openai.com/v1"
    codex_api_key: str = ""
    codex_api_key_file: str = ""
    codex_model: str = "gpt-5.3-codex"
    codex_reasoning_effort: str = "medium"

    # Local Codex CLI. Empty uses the model selected in ~/.codex/config.toml.
    # Defaults to the cheaper Luna tier so background agent runs stay affordable.
    codex_cli_model: str = "gpt-5.6-luna"

    # Local Claude Code CLI. Empty uses the model the CLI itself defaults to;
    # "sonnet" keeps ClawChat's own calls off the pricier flagship tier.
    claude_code_model: str = "sonnet"

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

    @field_validator("codex_reasoning_effort", mode="before")
    @classmethod
    def normalize_codex_reasoning_effort(cls, value):
        normalized = str(value).strip().lower()
        if normalized not in {"low", "medium", "high", "xhigh"}:
            raise ValueError("must be one of: low, medium, high, xhigh")
        return normalized

    @model_validator(mode="after")
    def resolve_codex_api_key(self):
        if self.codex_api_key:
            self.codex_api_key = self.codex_api_key.strip()
            return self

        conventional_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if conventional_key:
            self.codex_api_key = conventional_key
        elif self.codex_api_key_file:
            self.codex_api_key = _read_codex_api_key(self.codex_api_key_file)
        return self

    @model_validator(mode="after")
    def resolve_ai_provider(self):
        # A switch made in the app is the most recent expression of intent, so
        # it outranks the AI_PROVIDER default this process started with.
        if self.ai_provider_file:
            stored = _read_ai_provider(self.ai_provider_file)
            if stored:
                self.ai_provider = stored
        return self

    @model_validator(mode="after")
    def resolve_jwt_secret(self):
        if self.jwt_secret == _DEFAULT_JWT_SECRET:
            if self.jwt_secret_file:
                self.jwt_secret = _load_or_create_secret(self.jwt_secret_file)
                return self
            self.jwt_secret = secrets.token_urlsafe(32)
            logger.warning(
                "JWT_SECRET is using the default placeholder. "
                "Auto-generating a random secret for this session. "
                "Set JWT_SECRET or JWT_SECRET_FILE for stable sessions."
            )
        return self

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
