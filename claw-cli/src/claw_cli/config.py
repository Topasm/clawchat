"""Persistent CLI configuration (server URL, tokens) stored in OS config dir."""

from __future__ import annotations

import json
import time
from pathlib import Path

from platformdirs import user_config_dir

APP_NAME = "claw"
CONFIG_DIR = Path(user_config_dir(APP_NAME))
CONFIG_FILE = CONFIG_DIR / "config.json"


def _ensure_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load() -> dict:
    """Return current config dict (empty dict if no file)."""
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {}


def save(cfg: dict) -> None:
    _ensure_dir()
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2) + "\n")


def save_tokens(
    server_url: str,
    access_token: str,
    refresh_token: str,
    expires_in: int,
) -> None:
    cfg = load()
    cfg.update(
        server_url=server_url.rstrip("/"),
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=int(time.time()) + expires_in,
    )
    save(cfg)


def clear_tokens() -> None:
    cfg = load()
    for key in ("access_token", "refresh_token", "token_expires_at"):
        cfg.pop(key, None)
    save(cfg)


def get_server_url() -> str | None:
    return load().get("server_url")


def get_access_token() -> str | None:
    return load().get("access_token")


def get_refresh_token() -> str | None:
    return load().get("refresh_token")


def is_token_expired() -> bool:
    cfg = load()
    expires_at = cfg.get("token_expires_at", 0)
    return time.time() >= expires_at - 30  # 30s buffer
