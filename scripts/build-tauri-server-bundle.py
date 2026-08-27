"""Build the existing FastAPI server as the PyInstaller onedir resource used by Tauri."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
SERVER_ROOT = REPOSITORY_ROOT / "server"
BUNDLE_ROOT = SERVER_ROOT / "dist" / "clawchat-server"
MANIFEST_PATH = BUNDLE_ROOT / "bundle-manifest.json"
MINIMUM_PYTHON = (3, 11)


def require_supported_python() -> None:
    if sys.version_info < MINIMUM_PYTHON:
        required = ".".join(map(str, MINIMUM_PYTHON))
        current = platform.python_version()
        raise RuntimeError(
            f"Tauri server bundles require Python {required} or newer; current interpreter is {current}"
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_bundle_manifest(bundle_root: Path = BUNDLE_ROOT) -> Path:
    if not bundle_root.is_dir():
        raise RuntimeError(f"PyInstaller bundle was not created: {bundle_root}")

    files: list[dict[str, object]] = []
    for path in sorted(bundle_root.rglob("*")):
        if path == bundle_root / MANIFEST_PATH.name:
            continue
        if path.is_symlink():
            target = os.readlink(path)
            if os.path.isabs(target):
                raise RuntimeError(f"PyInstaller bundle contains an absolute symbolic link: {path}")
            resolved_target = (path.parent / target).resolve()
            try:
                resolved_target.relative_to(bundle_root.resolve())
            except ValueError as error:
                raise RuntimeError(
                    f"PyInstaller symbolic link escapes the bundle: {path} -> {target}"
                ) from error
            files.append(
                {
                    "path": path.relative_to(bundle_root).as_posix(),
                    "type": "symlink",
                    "target": target,
                }
            )
            continue
        if not path.is_file():
            continue
        files.append(
            {
                "path": path.relative_to(bundle_root).as_posix(),
                "type": "file",
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )

    executable = "clawchat-server.exe" if sys.platform == "win32" else "clawchat-server"
    if not any(entry["path"] == executable and entry["type"] == "file" for entry in files):
        raise RuntimeError(f"PyInstaller executable is missing: {bundle_root / executable}")

    files.sort(key=lambda entry: str(entry["path"]))

    manifest = {
        "schemaVersion": 1,
        "bundleType": "pyinstaller-onedir",
        "platform": sys.platform,
        "architecture": platform.machine(),
        "executable": executable,
        "files": files,
    }
    manifest_path = bundle_root / MANIFEST_PATH.name
    temporary_path = manifest_path.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(manifest_path)
    return manifest_path


def main() -> None:
    require_supported_python()
    import PyInstaller.__main__

    os.chdir(SERVER_ROOT)
    PyInstaller.__main__.run(
        [
            "run_server.py",
            "--name",
            "clawchat-server",
            "--onedir",
            "--noconfirm",
            "--distpath",
            str(SERVER_ROOT / "dist"),
            "--workpath",
            str(SERVER_ROOT / "build"),
            "--specpath",
            str(SERVER_ROOT),
            "--hidden-import",
            "aiosqlite",
            "--hidden-import",
            "sqlalchemy.dialects.sqlite",
            "--collect-submodules",
            "uvicorn",
            "--collect-all",
            "watchfiles",
            "--collect-submodules",
            "jose",
            "--paths",
            ".",
        ]
    )
    manifest_path = create_bundle_manifest()
    print(f"Created Tauri server bundle manifest: {manifest_path}")


if __name__ == "__main__":
    main()
