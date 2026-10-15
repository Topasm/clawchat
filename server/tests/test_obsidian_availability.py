"""Obsidian availability, project-root projects, and the background index build."""

import asyncio
import json
import stat
import threading

import pytest
from sqlalchemy import select

from config import settings
from models.user_settings import UserSettings
from services import lifecycle
from services.vault import obsidian_status
from services.vault import obsidian_vault_indexer as indexer
from ws.notifications import DEFAULT_USER_ID


def _fake_cli(tmp_path, *, version_ok: bool) -> str:
    script = tmp_path / "obsidian-cli"
    script.write_text(
        "#!/bin/sh\n"
        f'if [ "$1" = version ]; then exit {0 if version_ok else 1}; fi\n'
        "exit 0\n",
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return str(script)


@pytest.fixture
def vault(tmp_path, monkeypatch):
    root = tmp_path / "vault"
    (root / "00_Inbox").mkdir(parents=True)
    (root / "00_Inbox" / "TODO.md").write_text("- [ ] Inbox item\n", encoding="utf-8")
    (root / "01_Projects" / "Alpha").mkdir(parents=True)
    (root / "01_Projects" / "Beta").mkdir()
    (root / "01_Projects" / "Beta" / "TODO.md").write_text("# Beta\n", encoding="utf-8")
    (root / "01_Projects" / ".hidden").mkdir()
    monkeypatch.setattr(settings, "obsidian_vault_path", str(root))
    monkeypatch.setattr(settings, "obsidian_cli_command", "")
    monkeypatch.setattr(settings, "obsidian_project_root", "")
    monkeypatch.setattr(settings, "obsidian_project_todo_filename", "TODO.md")
    indexer._index = indexer.VaultIndex()
    obsidian_status.reset_cli_probe()
    yield root
    indexer._index = indexer.VaultIndex()
    obsidian_status.reset_cli_probe()


# ---------------------------------------------------------------------------
# Unified status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("version_ok", [True, False])
async def test_status_and_health_agree_on_cli_and_mode(
    client, auth_headers, vault, tmp_path, monkeypatch, version_ok
):
    # A configured CLI that cannot answer used to read "cli" on /status and
    # cli_available=false on /health.
    monkeypatch.setattr(
        settings, "obsidian_cli_command", _fake_cli(tmp_path, version_ok=version_ok)
    )

    status = (await client.get("/api/obsidian/status", headers=auth_headers)).json()
    health = (await client.get("/api/obsidian/health", headers=auth_headers)).json()

    for key in ("vault_available", "cli_available", "companion_online", "mode"):
        assert status[key] == health[key], key
    assert status["cli_available"] is version_ok
    assert status["mode"] == ("cli" if version_ok else "filesystem")
    assert status["vault_available"] is True
    assert status["cli_configured"] is True


@pytest.mark.asyncio
async def test_status_reports_disabled_without_a_vault(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "obsidian_vault_path", "")
    monkeypatch.setattr(settings, "obsidian_cli_command", "obsidian")
    obsidian_status.reset_cli_probe()

    status = (await client.get("/api/obsidian/status", headers=auth_headers)).json()

    assert status["enabled"] is False
    assert status["cli_available"] is False
    assert status["mode"] == "disabled"
    assert status["index_state"] == "disabled"


def test_cli_probe_is_cached(tmp_path, monkeypatch):
    counter = tmp_path / "calls"
    script = tmp_path / "cli"
    script.write_text(f'#!/bin/sh\necho x >> "{counter}"\nexit 0\n', encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setattr(settings, "obsidian_cli_command", str(script))
    obsidian_status.reset_cli_probe()

    assert obsidian_status.probe_cli() is True
    assert obsidian_status.probe_cli() is True
    assert counter.read_text().count("x") == 1
    assert obsidian_status.probe_cli(force=True) is True
    assert counter.read_text().count("x") == 2
    obsidian_status.reset_cli_probe()


# ---------------------------------------------------------------------------
# Project root
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_root_lists_folders_without_todo(client, auth_headers, vault, monkeypatch):
    before = (await client.get("/api/obsidian/projects", headers=auth_headers)).json()
    assert [p["folder"] for p in before["projects"]] == ["00_Inbox"]

    monkeypatch.setattr(settings, "obsidian_project_root", "01_Projects")
    indexer._index = indexer.VaultIndex()
    after = (await client.get("/api/obsidian/projects", headers=auth_headers)).json()

    by_folder = {p["folder"]: p for p in after["projects"]}
    assert set(by_folder) == {"00_Inbox", "01_Projects/Alpha", "01_Projects/Beta"}
    assert by_folder["01_Projects/Alpha"]["has_todo"] is False
    assert by_folder["01_Projects/Beta"]["has_todo"] is True
    assert after["project_root"] == "01_Projects"


@pytest.mark.asyncio
async def test_update_project_root_persists_and_reindexes(
    client, auth_headers, db_session, vault, monkeypatch
):
    response = await client.put(
        "/api/obsidian/project-root",
        json={"project_root": "01_Projects/"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"project_root": "01_Projects", "project_count": 3}
    assert settings.obsidian_project_root == "01_Projects"
    row = (
        await db_session.execute(
            select(UserSettings).where(UserSettings.user_id == DEFAULT_USER_ID)
        )
    ).scalar_one()
    assert json.loads(row.settings_json)["obsidian"] == {"project_root": "01_Projects"}

    # A restart applies the saved value over the environment default.
    monkeypatch.setattr(settings, "obsidian_project_root", "")
    from services.vault.obsidian_settings import apply_saved_project_root

    await apply_saved_project_root(db_session)
    assert settings.obsidian_project_root == "01_Projects"


@pytest.mark.asyncio
@pytest.mark.parametrize("root", ["../outside", "/etc", "Missing", "00_Inbox/TODO.md"])
async def test_update_project_root_rejects_bad_folders(client, auth_headers, vault, root):
    response = await client.put(
        "/api/obsidian/project-root", json={"project_root": root}, headers=auth_headers
    )

    assert response.status_code == 400
    assert settings.obsidian_project_root == ""


@pytest.mark.asyncio
async def test_create_project_todo(client, auth_headers, vault, monkeypatch):
    monkeypatch.setattr(settings, "obsidian_project_root", "01_Projects")

    created = await client.post(
        "/api/obsidian/projects/todo",
        json={"folder": "01_Projects/Alpha"},
        headers=auth_headers,
    )

    assert created.status_code == 201
    assert created.json()["has_todo"] is True
    todo = vault / "01_Projects" / "Alpha" / "TODO.md"
    assert todo.read_text(encoding="utf-8") == "# Alpha\n\n"
    projects = (await client.get("/api/obsidian/projects", headers=auth_headers)).json()
    alpha = next(p for p in projects["projects"] if p["folder"] == "01_Projects/Alpha")
    assert alpha["has_todo"] is True

    again = await client.post(
        "/api/obsidian/projects/todo",
        json={"folder": "01_Projects/Alpha"},
        headers=auth_headers,
    )
    assert again.status_code == 409
    assert todo.read_text(encoding="utf-8") == "# Alpha\n\n"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "folder,status_code",
    [
        ("00_Inbox", 400),  # not under the project root
        ("01_Projects/../00_Inbox", 400),
        ("01_Projects/.hidden", 400),
        ("01_Projects/Gone", 404),
    ],
)
async def test_create_project_todo_rejects_other_folders(
    client, auth_headers, vault, monkeypatch, folder, status_code
):
    monkeypatch.setattr(settings, "obsidian_project_root", "01_Projects")

    response = await client.post(
        "/api/obsidian/projects/todo", json={"folder": folder}, headers=auth_headers
    )

    assert response.status_code == status_code
    assert not (vault / "01_Projects" / ".hidden" / "TODO.md").exists()


def test_incremental_refresh_keeps_project_root_folder_without_todo(vault, monkeypatch):
    monkeypatch.setattr(settings, "obsidian_project_root", "01_Projects")
    indexer.refresh_index()
    (vault / "01_Projects" / "Gamma").mkdir()

    refreshed = indexer.refresh_changed_paths(
        {str(vault / "01_Projects" / "Alpha" / "note.md"), str(vault / "01_Projects" / "Gamma")}
    )

    assert refreshed.projects["01_Projects/Alpha"].has_todo is False
    assert refreshed.projects["01_Projects/Gamma"].has_todo is False


# ---------------------------------------------------------------------------
# Background index build
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_startup_does_not_wait_for_the_vault_scan(client, auth_headers, vault, monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    real_refresh = indexer._refresh_index_locked

    def slow_refresh():
        entered.set()
        assert release.wait(5), "scan was never released"
        return real_refresh()

    monkeypatch.setattr(indexer, "_refresh_index_locked", slow_refresh)

    task = lifecycle.start_vault_index_build()
    try:
        # Startup returned with the scan still running; the server answers.
        await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)
        assert not task.done()
        health = await asyncio.wait_for(client.get("/api/health"), 2)
        assert health.status_code == 200
        status = await asyncio.wait_for(
            client.get("/api/obsidian/status", headers=auth_headers), 2
        )
        assert status.json()["index_state"] == "scanning"
        obsidian_health = await asyncio.wait_for(
            client.get("/api/obsidian/health", headers=auth_headers), 2
        )
        assert obsidian_health.json()["index_state"] == "scanning"
    finally:
        release.set()
        await asyncio.wait_for(task, 5)

    assert indexer.index_state() == "ready"
    assert "00_Inbox" in indexer._index.projects


@pytest.mark.asyncio
async def test_background_build_skips_without_a_vault(monkeypatch):
    monkeypatch.setattr(settings, "obsidian_vault_path", "")
    monkeypatch.setattr(
        indexer, "refresh_index", lambda: pytest.fail("scanned without a vault")
    )

    await lifecycle.start_vault_index_build()


@pytest.mark.asyncio
async def test_lifespan_is_ready_before_the_vault_scan_finishes(
    vault, monkeypatch, session_factory
):
    import main

    release = threading.Event()
    entered = threading.Event()
    real_refresh = indexer._refresh_index_locked

    def slow_refresh():
        entered.set()
        release.wait(10)
        return real_refresh()

    async def no_probe(*_args, **_kwargs):
        return None

    monkeypatch.setattr(indexer, "_refresh_index_locked", slow_refresh)
    async def tables_exist():
        return None

    monkeypatch.setattr(main, "probe_optional_ai", no_probe)
    monkeypatch.setattr(main, "init_db", tables_exist)
    monkeypatch.setattr(main, "async_session_factory", session_factory)
    monkeypatch.setattr(lifecycle, "async_session_factory", session_factory)
    saved_state = dict(main.app.state._state)

    started = asyncio.Event()
    stop = asyncio.Event()

    async def run_server():
        async with main.lifespan(main.app):
            started.set()
            await stop.wait()

    server = asyncio.create_task(run_server())
    try:
        # Were the scan awaited, startup would sit behind it for 10 s.
        await asyncio.wait_for(started.wait(), 3)
        task = main.app.state.vault_index_task
        await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)
        assert not task.done()
        assert indexer.index_state() == "scanning"
        release.set()
        await asyncio.wait_for(asyncio.shield(task), 5)
        assert indexer.index_state() == "ready"
    finally:
        release.set()
        stop.set()
        await asyncio.wait_for(server, 10)
        main.app.state._state.clear()
        main.app.state._state.update(saved_state)
