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
from main import app  # noqa: E402


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
