#!/usr/bin/env python3
"""Export the FastAPI OpenAPI document deterministically.

The checked-in snapshot is the source consumed by client contract generators.  Use
``--check`` in CI so a server schema change cannot land without regenerated client
contracts.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = REPOSITORY_ROOT / "server"
DEFAULT_OUTPUT = SERVER_ROOT / "openapi.json"


def render_openapi() -> str:
    """Return the current application OpenAPI document in a stable format."""

    os.environ.setdefault("JWT_SECRET", "openapi-contract-generation-secret")
    sys.path.insert(0, str(SERVER_ROOT))

    from main import app  # noqa: PLC0415 - server path must be installed first

    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def check_snapshot(output: Path, rendered: str) -> bool:
    if not output.exists():
        print(f"OpenAPI snapshot is missing: {output.relative_to(REPOSITORY_ROOT)}", file=sys.stderr)
        return False

    current = output.read_text(encoding="utf-8")
    if current == rendered:
        print(f"OpenAPI snapshot is current: {output.relative_to(REPOSITORY_ROOT)}")
        return True

    diff = difflib.unified_diff(
        current.splitlines(),
        rendered.splitlines(),
        fromfile=str(output.relative_to(REPOSITORY_ROOT)),
        tofile="FastAPI app.openapi()",
        lineterm="",
    )
    print("OpenAPI snapshot is stale. Run `npm run generate:api`.", file=sys.stderr)
    for line in list(diff)[:120]:
        print(line, file=sys.stderr)
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail instead of updating a stale snapshot")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    rendered = render_openapi()

    if args.check:
        return 0 if check_snapshot(output, rendered) else 1

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")
    print(f"Wrote OpenAPI snapshot: {output.relative_to(REPOSITORY_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
