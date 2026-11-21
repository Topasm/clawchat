"""Entry point for the PyInstaller-bundled ClawChat server binary."""

import os
import sys

# Ensure bundled modules are importable when running as a frozen binary.
if getattr(sys, "frozen", False):
    bundle_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    if bundle_dir not in sys.path:
        sys.path.insert(0, bundle_dir)

import uvicorn  # noqa: E402

# Import the FastAPI app directly so PyInstaller traces all server imports.
from app_version import APP_VERSION  # noqa: E402
from config import settings  # noqa: E402
from main import app  # noqa: E402
from services import database_lock  # noqa: E402


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    # Claim the database before uvicorn starts, so a second server on the same
    # file exits with one line and EXIT_DATABASE_IN_USE instead of a startup
    # traceback (ADR 021). The lifespan's own claim is then a no-op.
    database_lock.claim_or_exit(
        settings.database_url,
        host=host,
        port=port,
        owner=settings.server_owner,
        version=APP_VERSION,
    )
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
