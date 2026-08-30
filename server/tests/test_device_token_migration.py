import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path


_SERVER_ROOT = Path(__file__).resolve().parents[1]
_PRE_HASH_REVISION = "d1e94a7c3f28"


def _run_alembic(database_path: Path, revision: str) -> None:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": f"sqlite+aiosqlite:///{database_path.as_posix()}",
            "JWT_SECRET": "device-token-migration-test-secret",
            "UPLOAD_DIR": str(database_path.parent / "uploads"),
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=_SERVER_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_existing_paired_device_bearer_tokens_are_hashed(tmp_path):
    database_path = tmp_path / "paired-device.db"
    plaintext_token = "header.payload.signature"
    _run_alembic(database_path, _PRE_HASH_REVISION)
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            INSERT INTO paired_devices (
                id, name, device_type, device_token, paired_at, last_seen, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "device-1",
                "Existing phone",
                "android",
                plaintext_token,
                "2026-08-30 00:00:00",
                "2026-08-30 00:00:00",
                1,
            ),
        )

    _run_alembic(database_path, "head")

    with sqlite3.connect(database_path) as connection:
        stored = connection.execute(
            "SELECT device_token FROM paired_devices WHERE id = 'device-1'"
        ).fetchone()[0]
    assert stored == hashlib.sha256(plaintext_token.encode("utf-8")).hexdigest()
