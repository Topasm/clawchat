import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from config import Settings, settings
from execution import cli_sessions
from main import app
from routers import ai_models
from services.ai.model_catalog import discover_models
from services.ai.model_settings import read_models, save_model


@pytest.fixture
def auth_client(client, auth_headers):
    client.headers.update(auth_headers)
    return client


@pytest.fixture
def model_state(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_models_file", str(tmp_path / "models.json"))
    monkeypatch.setattr(settings, "codex_cli_model", "old-model")
    monkeypatch.setattr(settings, "claude_code_model", "sonnet")
    monkeypatch.setattr(
        app.state, "codex_cli", SimpleNamespace(model="old-model"), raising=False
    )
    monkeypatch.setattr(
        app.state, "claude_code", SimpleNamespace(model="sonnet"), raising=False
    )
    monkeypatch.setattr(
        ai_models,
        "discover_models",
        AsyncMock(return_value=(["gpt-6-luna", "future-model"], "cli")),
    )


async def test_model_selection_requires_auth(client):
    response = await client.put(
        "/api/admin/ai/models/codex_cli", json={"model": "gpt-6-sol"}
    )
    assert response.status_code == 401


async def test_catalog_keeps_configured_model_and_future_ids(auth_client, model_state):
    response = await auth_client.get("/api/admin/ai/models/codex_cli")
    assert response.status_code == 200
    assert response.json()["models"] == ["gpt-6-luna", "future-model", "old-model"]


async def test_save_new_model_and_reload_across_restart(auth_client, model_state):
    response = await auth_client.put(
        "/api/admin/ai/models/codex_cli", json={"model": " future-model "}
    )
    assert response.status_code == 200
    assert app.state.codex_cli.model == "future-model"
    reloaded = Settings(
        _env_file=None,
        ai_models_file=settings.ai_models_file,
        codex_cli_model="environment-pin",
    )
    assert reloaded.codex_cli_model == "future-model"
    assert response.json()["persistent"]


async def test_cli_default_empty_and_claude_aliases_are_preserved(
    auth_client, model_state
):
    assert (
        await auth_client.put("/api/admin/ai/models/codex_cli", json={"model": ""})
    ).status_code == 200
    assert (
        await auth_client.put(
            "/api/admin/ai/models/claude_code", json={"model": "sonnet[1m]"}
        )
    ).status_code == 200
    assert read_models(settings.ai_models_file) == {
        "codex_cli": "",
        "claude_code": "sonnet[1m]",
    }


async def test_failed_persistence_does_not_change_running_model(
    auth_client, model_state, monkeypatch
):
    def fail(*args):
        raise OSError("read only")

    monkeypatch.setattr(ai_models, "save_model", fail)
    response = await auth_client.put(
        "/api/admin/ai/models/codex_cli", json={"model": "gpt-6-sol"}
    )
    assert response.status_code == 503
    assert app.state.codex_cli.model == "old-model"


async def test_invalid_model_control_character_rejected(auth_client, model_state):
    response = await auth_client.put(
        "/api/admin/ai/models/codex_cli", json={"model": "model\n--flag"}
    )
    assert response.status_code == 422


async def test_latest_installed_codex_catalog_paginates(monkeypatch):
    connection = SimpleNamespace(
        call=AsyncMock(
            side_effect=[
                {
                    "data": [
                        {"model": "gpt-6-luna"},
                        {"model": "hidden-model", "hidden": True},
                    ],
                    "nextCursor": "page2",
                },
                {"data": [{"model": "future-model"}], "nextCursor": None},
            ]
        )
    )

    @asynccontextmanager
    async def connect(*, prefer_live):
        assert not prefer_live
        yield connection

    monkeypatch.setattr(cli_sessions, "codex_connection", connect)
    models, source = await discover_models("codex_cli", SimpleNamespace())
    assert models == ["gpt-6-luna", "future-model"]
    assert source == "cli"
    assert connection.call.call_args.args[1]["cursor"] == "page2"


async def test_discovery_failure_is_labelled_as_suggestions(monkeypatch):
    @asynccontextmanager
    async def connect(**kwargs):
        raise OSError("offline")
        yield

    monkeypatch.setattr(cli_sessions, "codex_connection", connect)
    models, source = await discover_models("codex_cli", SimpleNamespace())
    assert source == "suggestions"
    assert "gpt-6-sol" in models


async def test_bidirectional_rpc_does_not_mistake_server_request_for_response():
    receive = AsyncMock(
        side_effect=[
            json.dumps(
                {
                    "id": 1,
                    "method": "item/commandExecution/requestApproval",
                    "params": {},
                }
            ),
            json.dumps({"method": "thread/status/changed", "params": {}}),
            json.dumps({"id": 1, "result": {"data": ["correct"]}}),
        ]
    )
    connection = cli_sessions.CodexConnection(AsyncMock(), receive, live=False)
    assert await connection.call("model/list") == {"data": ["correct"]}
    assert receive.await_count == 3


def test_defaults_and_explicit_old_pins(monkeypatch):
    for key in ("CODEX_MODEL", "CODEX_CLI_MODEL", "AI_MODELS_FILE", "AI_PROVIDER_FILE"):
        monkeypatch.delenv(key, raising=False)
    default = Settings(_env_file=None)
    assert default.codex_cli_model == "gpt-6-luna"
    assert default.codex_model == "gpt-6-sol"
    assert default.claude_code_model == "sonnet"
    pinned = Settings(
        _env_file=None, codex_model="gpt-5.3-codex", codex_cli_model="gpt-5.6-luna"
    )
    assert pinned.codex_model == "gpt-5.3-codex"
    assert pinned.codex_cli_model == "gpt-5.6-luna"


def test_desktop_model_preferences_use_provider_file_sibling(tmp_path):
    path = str(tmp_path / "active-ai-provider")
    save_model(path + ".models.json", "claude_code", "opus")
    configured = Settings(_env_file=None, ai_provider_file=path, ai_models_file="")
    assert configured.claude_code_model == "opus"
