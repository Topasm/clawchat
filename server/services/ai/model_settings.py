"""Version-independent model preferences and atomic local persistence."""

import json
import os
import tempfile
from pathlib import Path

MODEL_FIELDS = {
    "codex_cli": "codex_cli_model",
    "claude_code": "claude_code_model",
    "codex": "codex_model",
}


def read_models(path_value: str) -> dict[str, str]:
    if not path_value:
        return {}
    try:
        value = json.loads(Path(path_value).expanduser().read_text())
    except FileNotFoundError:
        return {}
    if not isinstance(value, dict):
        raise ValueError("Model preferences must be an object")
    return {
        key: model
        for key, model in value.items()
        if key in MODEL_FIELDS
        and isinstance(model, str)
        and len(model) <= 200
        and not any(ord(c) < 32 or ord(c) == 127 for c in model)
        and (key != "codex" or model.strip())
    }


def save_model(path_value: str, provider: str, model: str) -> None:
    path = Path(path_value).expanduser()
    values = read_models(path_value)
    values[provider] = model
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(values, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
