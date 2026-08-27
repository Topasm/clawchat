"""Read-only audit for an Electron userData to Tauri app-data import."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


IMPORT_MARKER = "electron-import-v1.json"
CONFIG_NAME = "server-config.json"
DATA_PATH = Path("server-data") / "data"
CONFIG_DEFAULTS: dict[str, Any] = {
    "appMode": "client",
    "port": 8000,
    "pin": "123456",
    "obsidianVaultPath": "",
    "hostServerUrl": "",
    "autoStartHost": False,
}


class VerificationError(RuntimeError):
    """Raised when imported data does not match its Electron source."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise VerificationError(f"cannot read JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"expected a JSON object in {path}")
    return value


def normalize_config(path: Path) -> dict[str, Any]:
    value = load_json(path)
    normalized = CONFIG_DEFAULTS | {
        key: value[key] for key in CONFIG_DEFAULTS if key in value
    }
    if "appMode" not in value and ("port" in value or "pin" in value):
        normalized["appMode"] = "host"
        normalized["autoStartHost"] = True
    return normalized


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise VerificationError(f"cannot hash {path}: {error}") from error
    return digest.hexdigest()


def snapshot_tree(root: Path) -> dict[str, tuple[int, str]]:
    if not root.is_dir():
        raise VerificationError(f"data directory does not exist: {root}")
    snapshot: dict[str, tuple[int, str]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise VerificationError(f"symbolic links are not allowed in imported data: {path}")
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            snapshot[relative] = (path.stat().st_size, sha256(path))
    return snapshot


def verify_import(electron_dir: Path, tauri_dir: Path) -> dict[str, Any]:
    source = electron_dir.expanduser().resolve(strict=True)
    destination = tauri_dir.expanduser().resolve(strict=True)
    if source == destination:
        raise VerificationError("Electron and Tauri directories must be different")

    marker = load_json(destination / IMPORT_MARKER)
    if marker.get("version") != 1:
        raise VerificationError("unsupported or missing import marker version")
    marker_source = marker.get("source")
    if not isinstance(marker_source, str) or Path(marker_source).resolve() != source:
        raise VerificationError("import marker source does not match the Electron directory")

    config_imported = marker.get("configImported") is True
    data_imported = marker.get("dataImported") is True
    if not config_imported and not data_imported:
        raise VerificationError("import marker reports that no data was imported")

    if config_imported:
        electron_config = normalize_config(source / CONFIG_NAME)
        tauri_config = normalize_config(destination / CONFIG_NAME)
        if electron_config != tauri_config:
            raise VerificationError("normalized server configuration differs after import")

    file_count = 0
    if data_imported:
        electron_snapshot = snapshot_tree(source / DATA_PATH)
        tauri_snapshot = snapshot_tree(destination / DATA_PATH)
        if electron_snapshot != tauri_snapshot:
            missing = sorted(electron_snapshot.keys() - tauri_snapshot.keys())
            extra = sorted(tauri_snapshot.keys() - electron_snapshot.keys())
            changed = sorted(
                name
                for name in electron_snapshot.keys() & tauri_snapshot.keys()
                if electron_snapshot[name] != tauri_snapshot[name]
            )
            raise VerificationError(
                "imported data differs "
                f"(missing={missing}, extra={extra}, changed={changed})"
            )
        file_count = len(electron_snapshot)

    return {
        "source": str(source),
        "destination": str(destination),
        "configImported": config_imported,
        "dataImported": data_imported,
        "verifiedFiles": file_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--electron-dir", type=Path, required=True)
    parser.add_argument("--tauri-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = verify_import(args.electron_dir, args.tauri_dir)
    except (OSError, VerificationError) as error:
        print(f"migration audit failed: {error}")
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
