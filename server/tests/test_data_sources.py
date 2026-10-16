"""Device data sources: what is shared, how requests reach the machine, and
what a phone sees when the machine is off."""

import asyncio
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from database import Base
from exceptions import AppError, ForbiddenError
from models.data_source import DataSource, DataSourceQuery
from models.execution_host import ExecutionHost
from schemas.data_source import DataQueryAnswer, DataQueryAnswerEntry, DataSourceIndexFile
from services.data_sources import service
from services.data_sources.policy import PathDenied, SharePolicy, normalize_path

DEVICE_ID = "6f1c2c1e-3a51-4c43-9e3e-0d9b7c2b1a10"


def _register_body(**overrides):
    body = {
        "device_id": DEVICE_ID,
        "host_label": "MacBook",
        "platform": "macos",
        "kind": "obsidian_vault",
        "name": "workspace",
        "include_folders": ["00_Inbox", "01_Projects"],
        "exclude_folders": ["01_Projects/개인서류"],
    }
    body.update(overrides)
    return body


# -- the share policy --------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("../secrets.md", "outside_source"),
        ("00_Inbox/../../etc/passwd", "outside_source"),
        ("/etc/passwd", "absolute_path"),
        ("~/notes.md", "absolute_path"),
        ("C:/Users/me", "absolute_path"),
        (".obsidian/workspace.json", "hidden_path"),
        ("00_Inbox/.git/config", "hidden_path"),
        ("bad\x00name", "invalid_path"),
    ],
)
def test_paths_that_leave_the_source_are_refused(raw, reason):
    with pytest.raises(PathDenied) as caught:
        normalize_path(raw)
    assert caught.value.reason == reason


def test_paths_are_normalised():
    assert normalize_path(None) == ""
    assert normalize_path("./00_Inbox//TODO.md") == "00_Inbox/TODO.md"
    assert normalize_path("00_Inbox\\TODO.md") == "00_Inbox/TODO.md"
    # macOS names are NFD; the phone types NFC.
    assert normalize_path(unicodedata.normalize("NFD", "01_Projects/개인서류")) == (
        "01_Projects/개인서류"
    )


def test_only_shared_folders_and_the_way_down_to_them_are_visible():
    policy = SharePolicy.from_lists(["01_Projects"], ["01_Projects/개인서류"])

    assert policy.can_read("01_Projects/E65/TODO.md")
    assert not policy.can_read("02_Resources/bank.md")
    assert not policy.can_read("01_Projects/개인서류/passport.md")
    # The root can be browsed, but only towards what is shared.
    assert policy.can_list("")
    assert policy.shows_entry("01_Projects", is_dir=True)
    assert not policy.shows_entry("02_Resources", is_dir=True)
    assert not policy.shows_entry("01_Projects/개인서류", is_dir=True)
    assert not policy.can_read("")


def test_an_empty_include_list_shares_the_whole_source_minus_exclusions():
    policy = SharePolicy.from_lists([], ["Private"])
    assert policy.can_read("anything/here.md")
    assert not policy.can_read("Private/diary.md")


# -- registration ------------------------------------------------------------


@pytest.mark.asyncio
async def test_registering_a_source_does_not_offer_the_machine_for_runs(
    client, auth_headers, db_session
):
    first = await client.post("/api/data-sources", json=_register_body(), headers=auth_headers)
    again = await client.post("/api/data-sources", json=_register_body(), headers=auth_headers)

    assert first.status_code == 200, first.text
    assert again.json()["id"] == first.json()["id"]
    data = first.json()
    assert data["host_label"] == "MacBook"
    assert data["include_folders"] == ["00_Inbox", "01_Projects"]
    assert data["is_online"] is False
    assert data["capabilities"] == ["list", "read", "search"]

    host = (await db_session.execute(select(ExecutionHost))).scalar_one()
    assert host.kind == "worker"
    assert host.last_seen_at is None


@pytest.mark.asyncio
async def test_a_shared_folder_outside_the_source_is_rejected(client, auth_headers):
    response = await client.post(
        "/api/data-sources",
        json=_register_body(include_folders=["../Documents"]),
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["details"]["reason"] == "outside_source"


# -- requests while the machine is off ----------------------------------------


async def _register(client, auth_headers, **overrides) -> str:
    response = await client.post(
        "/api/data-sources", json=_register_body(**overrides), headers=auth_headers
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def _index(client, auth_headers, source_id):
    files = [
        {"path": "00_Inbox/TODO.md", "title": "Inbox", "modified_at": "2026-10-14T09:00:00Z"},
        {"path": "01_Projects/E65/TODO.md", "modified_at": "2026-10-13T09:00:00Z"},
        {"path": "01_Projects/E65/notes/meeting.md"},
        {"path": "01_Projects/개인서류/passport.md"},
        {"path": "02_Resources/bank.md"},
        {"path": "../escape.md"},
    ]
    response = await client.put(
        f"/api/data-sources/{source_id}/index", json={"files": files}, headers=auth_headers
    )
    assert response.status_code == 204, response.text


@pytest.mark.asyncio
async def test_the_index_keeps_only_shared_names(client, auth_headers):
    source_id = await _register(client, auth_headers)
    await _index(client, auth_headers, source_id)

    source = (await client.get(f"/api/data-sources/{source_id}", headers=auth_headers)).json()
    # Sending the index counts as being seen.
    assert source["indexed_files"] == 3
    assert source["index_updated_at"] is not None


@pytest.mark.asyncio
async def test_offline_listing_comes_from_the_index_and_reading_is_refused(
    client, auth_headers, db_session
):
    source_id = await _register(client, auth_headers)
    await _index(client, auth_headers, source_id)
    # The machine closed its app a while ago.
    source = await db_session.get(DataSource, source_id)
    source.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    await db_session.commit()

    listing = await client.post(
        f"/api/data-sources/{source_id}/query",
        json={"op": "list", "path": "01_Projects"},
        headers=auth_headers,
    )
    assert listing.status_code == 200, listing.text
    data = listing.json()
    assert data["origin"] == "cache"
    assert data["fallback_reason"] == "offline"
    assert data["is_online"] is False
    assert data["last_seen_at"] is not None
    assert [(e["name"], e["is_dir"]) for e in data["entries"]] == [("E65", True)]

    root = await client.post(
        f"/api/data-sources/{source_id}/query", json={"op": "list"}, headers=auth_headers
    )
    assert [e["name"] for e in root.json()["entries"]] == ["00_Inbox", "01_Projects"]

    search = await client.post(
        f"/api/data-sources/{source_id}/query",
        json={"op": "search", "query": "inbox"},
        headers=auth_headers,
    )
    assert [m["path"] for m in search.json()["matches"]] == ["00_Inbox/TODO.md"]

    read = await client.post(
        f"/api/data-sources/{source_id}/query",
        json={"op": "read", "path": "00_Inbox/TODO.md"},
        headers=auth_headers,
    )
    assert read.status_code == 503
    assert read.json()["error"]["code"] == "DATA_SOURCE_OFFLINE"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("../escape.md", "outside_source"),
        ("02_Resources/bank.md", "not_shared"),
        ("01_Projects/개인서류/passport.md", "not_shared"),
        (".obsidian/app.json", "hidden_path"),
    ],
)
async def test_refused_paths_are_recorded(client, auth_headers, path, reason):
    source_id = await _register(client, auth_headers)

    response = await client.post(
        f"/api/data-sources/{source_id}/query",
        json={"op": "read", "path": path},
        headers=auth_headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["details"]["reason"] == reason
    log = (
        await client.get(f"/api/data-sources/{source_id}/queries", headers=auth_headers)
    ).json()
    assert log[0]["status"] == "denied"
    assert log[0]["error"] == reason
    assert log[0]["requested_by"] == "user"


@pytest.mark.asyncio
async def test_an_operation_the_source_does_not_offer_is_refused(client, auth_headers):
    source_id = await _register(client, auth_headers, capabilities=["list"])
    response = await client.post(
        f"/api/data-sources/{source_id}/query",
        json={"op": "search", "query": "x"},
        headers=auth_headers,
    )
    assert response.status_code == 403
    assert response.json()["error"]["details"]["reason"] == "operation_not_allowed"


# -- relaying to a live machine ----------------------------------------------


@pytest.fixture
async def sessions(tmp_path):
    """Two independent sessions on one database: the asker's and the machine's."""
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'data-sources.db'}", pool_size=4, max_overflow=0
    )
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield factory
    await engine.dispose()


async def _seed_online_source(factory, **policy) -> tuple[str, str]:
    async with factory() as db:
        host = ExecutionHost(label="MacBook", kind="worker", device_id=str(uuid.uuid4()))
        db.add(host)
        await db.flush()
        source = DataSource(host_id=host.id, kind="obsidian_vault", name="workspace")
        service.apply_settings(
            source,
            capabilities=["list", "read", "search"],
            include_folders=policy.get("include", ["00_Inbox", "01_Projects"]),
            exclude_folders=policy.get("exclude", []),
        )
        source.last_seen_at = datetime.now(timezone.utc)
        db.add(source)
        await db.commit()
        return host.id, source.id


async def _ask(factory, source_id, *, op, path=None, text=None, timeout=5.0):
    async with factory() as db:
        source = await db.get(DataSource, source_id)
        return await service.query_source(
            db, source, op=op, raw_path=path, text=text, requested_by="phone-1", timeout=timeout
        )


async def _answer(factory, host_id, answer_for):
    async with factory() as db:
        host = await db.get(ExecutionHost, host_id)
        claimed = await service.claim_next_query(db, host, wait_seconds=5)
        assert claimed is not None
        await service.submit_answer(db, host, claimed.query_id, answer_for(claimed))
        return claimed


@pytest.mark.asyncio
async def test_a_read_is_relayed_to_the_machine_and_not_kept(sessions):
    host_id, source_id = await _seed_online_source(sessions)
    todo = "# Inbox\n- [ ] Email Kim @due(2026-10-20) @high\n- [x] Book flights\nplain text\n"

    asked, claimed = await asyncio.gather(
        _ask(sessions, source_id, op="read", path="00_Inbox/TODO.md"),
        _answer(sessions, host_id, lambda q: DataQueryAnswer(ok=True, content=todo)),
    )

    assert claimed.path == "00_Inbox/TODO.md"
    assert claimed.include_folders == ["00_Inbox", "01_Projects"]
    assert asked.origin == "live"
    assert asked.content == todo
    assert [(t.title, t.status) for t in asked.tasks] == [
        ("Email Kim", "pending"),
        ("Book flights", "completed"),
    ]
    assert (asked.tasks[0].due_date, asked.tasks[0].priority) == ("2026-10-20", "high")
    async with sessions() as db:
        row = (await db.execute(select(DataSourceQuery))).scalar_one()
        assert row.status == "done"
        assert row.requested_by == "phone-1"
        # The contents passed through; only their size stays behind.
        assert row.result is None
        assert row.result_bytes and row.result_bytes > len(todo)


@pytest.mark.asyncio
async def test_a_listing_drops_whatever_the_device_should_not_have_sent(sessions):
    host_id, source_id = await _seed_online_source(sessions, include=["01_Projects"])

    def answer(_query):
        return DataQueryAnswer(
            ok=True,
            entries=[
                DataQueryAnswerEntry(path="01_Projects", is_dir=True),
                DataQueryAnswerEntry(path="02_Resources", is_dir=True),
                DataQueryAnswerEntry(path="README.md"),
                DataQueryAnswerEntry(path=".obsidian", is_dir=True),
            ],
        )

    asked, _ = await asyncio.gather(
        _ask(sessions, source_id, op="list"),
        _answer(sessions, host_id, answer),
    )

    assert [(e.name, e.is_dir) for e in asked.entries] == [("01_Projects", True)]


@pytest.mark.asyncio
async def test_a_device_refusal_reaches_the_asker_as_forbidden(sessions):
    host_id, source_id = await _seed_online_source(sessions)

    results = await asyncio.gather(
        _ask(sessions, source_id, op="read", path="00_Inbox/link.md"),
        _answer(sessions, host_id, lambda q: DataQueryAnswer(ok=False, error="symlink")),
        return_exceptions=True,
    )

    assert isinstance(results[0], ForbiddenError)
    async with sessions() as db:
        row = (await db.execute(select(DataSourceQuery))).scalar_one()
        assert (row.status, row.error) == ("failed", "symlink")


@pytest.mark.asyncio
async def test_a_slow_machine_falls_back_to_the_index_and_its_late_answer_is_dropped(sessions):
    host_id, source_id = await _seed_online_source(sessions)
    async with sessions() as db:
        source = await db.get(DataSource, source_id)
        await service.replace_index(
            db, source, [DataSourceIndexFile(path="00_Inbox/TODO.md", title="Inbox")]
        )
        await db.commit()

    listing = await _ask(sessions, source_id, op="list", path="00_Inbox", timeout=0.2)
    assert listing.origin == "cache"
    assert listing.fallback_reason == "timeout"
    assert [e.path for e in listing.entries] == ["00_Inbox/TODO.md"]

    with pytest.raises(AppError) as caught:
        await _ask(sessions, source_id, op="read", path="00_Inbox/TODO.md", timeout=0.2)
    assert caught.value.code == "DATA_SOURCE_TIMEOUT"
    assert caught.value.status_code == 504

    async with sessions() as db:
        host = await db.get(ExecutionHost, host_id)
        # Nothing expired is handed out, and nothing late is stored.
        assert await service.claim_next_query(db, host) is None
        statuses = (await db.execute(select(DataSourceQuery.status))).scalars().all()
        assert set(statuses) == {"expired"}


@pytest.mark.asyncio
async def test_claiming_keeps_sources_online_without_checking_the_host_in(sessions):
    host_id, source_id = await _seed_online_source(sessions)
    async with sessions() as db:
        source = await db.get(DataSource, source_id)
        source.last_seen_at = None
        await db.commit()
        host = await db.get(ExecutionHost, host_id)
        assert await service.claim_next_query(db, host, wait_seconds=0) is None

    async with sessions() as db:
        source = await db.get(DataSource, source_id)
        host = await db.get(ExecutionHost, host_id)
        assert service.is_online(source)
        assert host.last_seen_at is None


@pytest.mark.asyncio
async def test_policy_changes_prune_the_index(client, auth_headers):
    source_id = await _register(client, auth_headers)
    await _index(client, auth_headers, source_id)

    response = await client.patch(
        f"/api/data-sources/{source_id}",
        json={"exclude_folders": ["01_Projects/E65"]},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["indexed_files"] == 1
    assert response.json()["exclude_folders"] == ["01_Projects/E65"]


# -- project folders a shared vault already has ---------------------------------


@pytest.mark.asyncio
async def test_a_shared_vaults_project_folders_are_offered_as_projects(client, auth_headers):
    source_id = await _register(client, auth_headers)
    files = [
        {"path": "00_Inbox/TODO.md"},
        {"path": "01_Projects/FreqMotion/plan.md"},
        {"path": "01_Projects/iclr_2027/TODO.md"},
        {"path": "01_Projects/postech_coursework_2/GPU_Computing/hw1.md"},
        {"path": "01_Projects/개인서류/passport.md"},
        {"path": "01_Projects/.trash/old.md"},
    ]
    response = await client.put(
        f"/api/data-sources/{source_id}/index", json={"files": files}, headers=auth_headers
    )
    assert response.status_code == 204, response.text
    await client.post("/api/projects", json={"title": "FreqMotion"}, headers=auth_headers)

    candidates = (
        await client.get("/api/inbox/project-candidates", headers=auth_headers)
    ).json()
    # Excluded folders and the vault's inbox stay out, and a folder a project
    # already has is not offered.
    assert [(item["name"], item["folder"], item["has_todo"]) for item in candidates] == [
        ("iclr_2027", "01_Projects/iclr_2027", True),
        ("postech_coursework_2", "01_Projects/postech_coursework_2", False),
    ]
    assert {item["source_name"] for item in candidates} == {"workspace"}
