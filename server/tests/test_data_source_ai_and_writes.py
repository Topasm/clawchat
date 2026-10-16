"""Device data sources, phase 3: what the AI may read, and changes that wait
for approval before they reach the machine."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from database import Base
from domain.review import ReviewStatus, ReviewSubjectType
from exceptions import AppError, ForbiddenError, ValidationError
from models.data_source import DataSource, DataSourceQuery
from models.execution_host import ExecutionHost
from models.review_item import ReviewItem
from schemas.data_source import DataQueryAnswer, DataSourceIndexFile
from services.chat.chat_tools import reply_events
from services.data_sources import service
from services.tools import gateway, vault_tools
from services.tools.catalog import tools_for_chat, tools_for_skill
from services.tools.tool_loop import AssistantTurn, ToolCallRequest

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


async def _register(client, auth_headers, **overrides) -> str:
    response = await client.post(
        "/api/data-sources", json=_register_body(**overrides), headers=auth_headers
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def _log(client, auth_headers, source_id):
    response = await client.get(f"/api/data-sources/{source_id}/queries", headers=auth_headers)
    return response.json()


# -- the switches -------------------------------------------------------------


@pytest.mark.asyncio
async def test_ai_access_and_writes_are_off_unless_the_machine_says_otherwise(
    client, auth_headers
):
    first = await client.post("/api/data-sources", json=_register_body(), headers=auth_headers)
    assert (first.json()["ai_access"], first.json()["allow_writes"]) == (False, False)

    on = await client.post(
        "/api/data-sources",
        json=_register_body(ai_access=True, allow_writes=True),
        headers=auth_headers,
    )
    assert (on.json()["ai_access"], on.json()["allow_writes"]) == (True, True)

    # An older app that does not know the switches turns them off again.
    again = await client.post("/api/data-sources", json=_register_body(), headers=auth_headers)
    assert again.json()["id"] == first.json()["id"]
    assert (again.json()["ai_access"], again.json()["allow_writes"]) == (False, False)


@pytest.mark.asyncio
async def test_another_device_cannot_turn_ai_access_on(client, auth_headers, db_session):
    source_id = await _register(client, auth_headers)
    response = await client.patch(
        f"/api/data-sources/{source_id}",
        json={"ai_access": True, "allow_writes": True},
        headers=auth_headers,
    )
    assert response.status_code == 200
    source = await db_session.get(DataSource, source_id)
    await db_session.refresh(source)
    assert (source.ai_access, source.allow_writes) == (False, False)


# -- what the AI is offered ---------------------------------------------------


@pytest.mark.asyncio
async def test_vault_tools_are_offered_only_for_sources_shared_with_the_ai(
    client, auth_headers, db_session
):
    await _register(client, auth_headers)
    assert [spec.name for spec in await tools_for_chat(db_session)] == []

    await _register(client, auth_headers, ai_access=True)
    assert [spec.name for spec in await tools_for_chat(db_session)] == [
        "vault_search",
        "vault_read",
    ]

    await _register(client, auth_headers, ai_access=True, allow_writes=True)
    db_session.expire_all()
    chat_tools = await tools_for_chat(db_session)
    assert [spec.name for spec in chat_tools] == ["vault_search", "vault_read", "vault_add_task"]
    assert "'workspace' on MacBook" in chat_tools[0].description

    # Agents get the same tools through the skill catalogue; a skill that
    # names its servers gets them only by naming ``vault``.
    assert {spec.name for spec in await tools_for_skill(db_session, "research")} >= {
        "vault_search",
        "vault_read",
    }


@pytest.mark.asyncio
async def test_a_skill_limited_to_other_servers_does_not_get_the_vault(
    client, auth_headers, db_session, monkeypatch
):
    from dataclasses import replace

    from skills import SKILL_REGISTRY

    await _register(client, auth_headers, ai_access=True)
    skill = SKILL_REGISTRY["research"]
    monkeypatch.setitem(SKILL_REGISTRY, "research", replace(skill, mcp_servers=("notes",)))
    assert not {spec.name for spec in await tools_for_skill(db_session, "research")} & set(
        vault_tools.VAULT_TOOLS
    )
    monkeypatch.setitem(SKILL_REGISTRY, "research", replace(skill, mcp_servers=("vault",)))
    assert {spec.name for spec in await tools_for_skill(db_session, "research")} >= {
        "vault_search",
        "vault_read",
    }


@pytest.mark.asyncio
async def test_a_read_for_the_ai_is_refused_and_recorded_without_ai_access(
    client, auth_headers, db_session
):
    source_id = await _register(client, auth_headers)
    source = await db_session.get(DataSource, source_id)

    with pytest.raises(ForbiddenError) as caught:
        await service.query_source(
            db_session,
            source,
            op="read",
            raw_path="00_Inbox/TODO.md",
            text=None,
            requested_by="chat:conv_1",
            for_ai=True,
        )

    assert caught.value.details == {"reason": "ai_access_off"}
    log = await _log(client, auth_headers, source_id)
    assert (log[0]["status"], log[0]["error"], log[0]["requested_by"]) == (
        "denied",
        "ai_access_off",
        "chat:conv_1",
    )


@pytest.mark.asyncio
async def test_the_ai_is_held_to_the_share_policy(client, auth_headers, db_session):
    source_id = await _register(client, auth_headers, ai_access=True)

    text, is_error = await vault_tools.execute(
        db_session,
        "vault_read",
        {"path": "01_Projects/개인서류/passport.md"},
        requested_by="run:run_1",
    )

    assert is_error
    assert "not_shared" in text
    log = await _log(client, auth_headers, source_id)
    assert (log[0]["status"], log[0]["error"], log[0]["requested_by"]) == (
        "denied",
        "not_shared",
        "run:run_1",
    )


class VaultSearchingAI:
    """Searches the shared folder once, then answers from what it found."""

    supports_native_tool_calling = True

    async def tool_turn(self, *, system_prompt, transcript, tools):
        if not any(entry["role"] == "tool" for entry in transcript):
            return AssistantTurn(
                content=None,
                tool_calls=[ToolCallRequest("c1", "vault_search", {"query": "inbox"})],
            )
        found = next(e["content"] for e in transcript if e["role"] == "tool")
        return AssistantTurn(content=found)

    async def stream_completion(self, messages):
        raise AssertionError("a tool-capable provider must run the loop")


@pytest.mark.asyncio
async def test_chat_searches_a_shared_folder_and_the_read_names_the_chat(
    client, auth_headers, db_session, session_factory
):
    source_id = await _register(client, auth_headers, ai_access=True)
    source = await db_session.get(DataSource, source_id)
    await service.replace_index(
        db_session,
        source,
        [
            DataSourceIndexFile(path="00_Inbox/TODO.md", title="Inbox"),
            DataSourceIndexFile(path="01_Projects/개인서류/inbox.md"),
        ],
    )
    # The machine has since gone to sleep.
    source.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    await db_session.commit()

    events = [
        event
        async for event in reply_events(
            session_factory,
            VaultSearchingAI(),
            [{"role": "user", "content": "What is in my inbox?"}],
            conversation_id="conv_1",
        )
    ]

    assert [e.kind for e in events] == ["activity", "token"]
    assert events[0].payload == {"tool": "vault_search", "label": "search shared notes"}
    assert "00_Inbox/TODO.md" in events[1].text
    assert "개인서류" not in events[1].text
    assert "only file names were searched" in events[1].text
    log = await _log(client, auth_headers, source_id)
    assert (log[0]["op"], log[0]["requested_by"], log[0]["error"]) == (
        "search",
        "chat:conv_1",
        "source_offline",
    )


@pytest.mark.asyncio
async def test_a_call_without_a_named_chat_or_run_is_still_recorded(
    client, auth_headers, db_session
):
    source_id = await _register(client, auth_headers, ai_access=True)
    specs = {spec.name: spec for spec in await tools_for_chat(db_session)}

    text = await gateway.invoke(
        db_session, run_id=None, spec=specs["vault_search"], arguments={"query": "x"}
    )

    assert "Nothing matched" in text
    log = await _log(client, auth_headers, source_id)
    assert log[0]["requested_by"] == "chat"


# -- writes -------------------------------------------------------------------


async def _propose(client, auth_headers, source_id, path="00_Inbox/TODO.md", text="Email Kim"):
    return await client.post(
        f"/api/data-sources/{source_id}/writes",
        json={"path": path, "text": text},
        headers=auth_headers,
    )


@pytest.mark.asyncio
async def test_a_write_is_refused_and_recorded_unless_the_source_takes_changes(
    client, auth_headers
):
    source_id = await _register(client, auth_headers)

    response = await _propose(client, auth_headers, source_id)

    assert response.status_code == 403
    assert response.json()["error"]["details"]["reason"] == "writes_not_allowed"
    log = await _log(client, auth_headers, source_id)
    assert (log[0]["op"], log[0]["status"], log[0]["error"]) == (
        "append_todo",
        "denied",
        "writes_not_allowed",
    )
    reviews = (await client.get("/api/reviews", headers=auth_headers)).json()
    assert reviews == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("00_Inbox/notes.md", "not_todo_file"),
        ("02_Resources/TODO.md", "not_shared"),
        ("01_Projects/개인서류/TODO.md", "not_shared"),
        ("../TODO.md", "outside_source"),
        (".obsidian/TODO.md", "hidden_path"),
    ],
)
async def test_a_write_only_goes_to_a_shared_todo_file(client, auth_headers, path, reason):
    source_id = await _register(client, auth_headers, allow_writes=True)
    response = await _propose(client, auth_headers, source_id, path=path)
    assert response.status_code == 403
    assert response.json()["error"]["details"]["reason"] == reason


@pytest.mark.asyncio
async def test_the_ai_cannot_propose_a_write_without_ai_access(client, auth_headers, db_session):
    source_id = await _register(client, auth_headers, allow_writes=True)
    source = await db_session.get(DataSource, source_id)
    with pytest.raises(ForbiddenError) as caught:
        await service.propose_write(
            db_session,
            source,
            op="append_todo",
            raw_path="00_Inbox/TODO.md",
            text="Email Kim",
            requested_by="run:run_1",
            for_ai=True,
        )
    assert caught.value.details == {"reason": "ai_access_off"}


def test_a_task_is_one_unchecked_line():
    assert service.task_line("  Email Kim\n# Heading\n- [ ] more ") == (
        "- [ ] Email Kim # Heading - [ ] more"
    )
    assert service.task_line("- [x] Already a task") == "- [ ] Already a task"
    with pytest.raises(ValidationError):
        service.task_line(" \n ")
    with pytest.raises(ValidationError):
        service.task_line("x" * (service.MAX_TASK_CHARS + 1))


@pytest.mark.asyncio
async def test_a_proposed_write_waits_in_review_and_never_reaches_the_machine_on_reject(
    client, auth_headers, db_session
):
    source_id = await _register(client, auth_headers, allow_writes=True)
    source = await db_session.get(DataSource, source_id)
    source.last_seen_at = datetime.now(timezone.utc)
    await db_session.commit()

    response = await _propose(client, auth_headers, source_id, text="Email Kim\n# injected")

    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal["line"] == "- [ ] Email Kim # injected"
    assert proposal["status"] == "awaiting_approval"

    reviews = (await client.get("/api/reviews", headers=auth_headers)).json()
    assert [r["subject_type"] for r in reviews] == ["data_source_write"]
    review = reviews[0]
    assert review["id"] == proposal["review_id"]
    assert review["subject_description"] == "- [ ] Email Kim # injected"
    assert review["metadata"]["path"] == "00_Inbox/TODO.md"
    assert review["metadata"]["host_label"] == "MacBook"

    # Nothing waits for the machine before the decision.
    host = await db_session.get(ExecutionHost, source.host_id)
    assert await service.claim_next_query(db_session, host) is None

    changes = await client.post(
        f"/api/reviews/{review['id']}/decision",
        json={"decision": "changes_requested", "note": "reword"},
        headers=auth_headers,
    )
    assert changes.status_code == 400

    rejected = await client.post(
        f"/api/reviews/{review['id']}/decision",
        json={"decision": "rejected"},
        headers=auth_headers,
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["outcome"] == {
        "query_id": proposal["query_id"],
        "status": "denied",
        "error": "rejected",
    }
    assert await service.claim_next_query(db_session, host) is None
    log = await _log(client, auth_headers, source_id)
    assert (log[0]["status"], log[0]["error"]) == ("denied", "rejected")


@pytest.mark.asyncio
async def test_approving_while_the_machine_is_off_keeps_the_review_open(
    client, auth_headers, db_session
):
    source_id = await _register(client, auth_headers, allow_writes=True)
    proposal = (await _propose(client, auth_headers, source_id)).json()

    response = await client.post(
        f"/api/reviews/{proposal['review_id']}/decision",
        json={"decision": "approved"},
        headers=auth_headers,
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATA_SOURCE_OFFLINE"
    item = await db_session.get(ReviewItem, proposal["review_id"])
    assert item.status == ReviewStatus.PENDING
    row = await db_session.get(DataSourceQuery, proposal["query_id"])
    assert row.status == "awaiting_approval"


@pytest.mark.asyncio
async def test_approval_rechecks_that_the_source_still_takes_changes(
    client, auth_headers, db_session
):
    source_id = await _register(client, auth_headers, allow_writes=True)
    proposal = (await _propose(client, auth_headers, source_id)).json()
    # The owner switched writes off on the machine before anyone approved.
    await _register(client, auth_headers, allow_writes=False)
    source = await db_session.get(DataSource, source_id)
    await db_session.refresh(source)
    source.last_seen_at = datetime.now(timezone.utc)
    await db_session.commit()

    response = await client.post(
        f"/api/reviews/{proposal['review_id']}/decision",
        json={"decision": "approved"},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["outcome"]["error"] == "writes_not_allowed"
    host = await db_session.get(ExecutionHost, source.host_id)
    assert await service.claim_next_query(db_session, host) is None


# -- an approved write reaching a live machine --------------------------------


@pytest.fixture
async def sessions(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'writes.db'}", pool_size=4, max_overflow=0
    )
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield factory
    await engine.dispose()


async def _seed(factory, *, allow_writes=True, ai_access=True) -> tuple[str, str]:
    async with factory() as db:
        host = ExecutionHost(label="MacBook", kind="worker", device_id=str(uuid.uuid4()))
        db.add(host)
        await db.flush()
        source = DataSource(host_id=host.id, kind="obsidian_vault", name="workspace")
        service.apply_settings(
            source,
            capabilities=["list", "read", "search"],
            include_folders=["00_Inbox"],
            exclude_folders=[],
            ai_access=ai_access,
            allow_writes=allow_writes,
        )
        source.last_seen_at = datetime.now(timezone.utc)
        db.add(source)
        await db.commit()
        return host.id, source.id


async def _propose_as_ai(factory, source_id) -> str:
    async with factory() as db:
        text, is_error = await vault_tools.execute(
            db,
            "vault_add_task",
            {"path": "00_Inbox/TODO.md", "task": "Draft the abstract"},
            requested_by="run:run_7",
        )
        assert not is_error, text
        assert "waits for the user's approval" in text
        return (await db.execute(select(DataSourceQuery.id))).scalar_one()


async def _approve(factory, query_id, timeout=5.0):
    async with factory() as db:
        return await service.decide_write(db, query_id, ReviewStatus.APPROVED, timeout=timeout)


async def _answer(factory, host_id, answer):
    async with factory() as db:
        host = await db.get(ExecutionHost, host_id)
        claimed = await service.claim_next_query(db, host, wait_seconds=5)
        assert claimed is not None
        await service.submit_answer(db, host, claimed.query_id, answer)
        return claimed


@pytest.mark.asyncio
async def test_an_approved_write_is_sent_to_the_machine(sessions):
    host_id, source_id = await _seed(sessions)
    query_id = await _propose_as_ai(sessions, source_id)
    async with sessions() as db:
        item = (await db.execute(select(ReviewItem))).scalar_one()
        assert item.subject_type == ReviewSubjectType.DATA_SOURCE_WRITE
        host = await db.get(ExecutionHost, host_id)
        assert await service.claim_next_query(db, host) is None

    outcome, claimed = await asyncio.gather(
        _approve(sessions, query_id),
        _answer(sessions, host_id, DataQueryAnswer(ok=True)),
    )

    assert (claimed.op, claimed.path, claimed.query) == (
        "append_todo",
        "00_Inbox/TODO.md",
        "- [ ] Draft the abstract",
    )
    assert outcome == {"query_id": query_id, "status": "done", "error": None}
    async with sessions() as db:
        row = await db.get(DataSourceQuery, query_id)
        assert row.requested_by == "run:run_7"
        assert row.approved_at is not None
        assert row.result is None


@pytest.mark.asyncio
async def test_the_machine_refusing_a_write_is_recorded(sessions):
    host_id, source_id = await _seed(sessions)
    query_id = await _propose_as_ai(sessions, source_id)

    outcome, _ = await asyncio.gather(
        _approve(sessions, query_id),
        _answer(sessions, host_id, DataQueryAnswer(ok=False, error="writes_not_allowed")),
    )

    assert outcome["status"] == "failed"
    assert outcome["error"] == "writes_not_allowed"


@pytest.mark.asyncio
async def test_a_write_cannot_be_decided_twice(sessions):
    host_id, source_id = await _seed(sessions)
    query_id = await _propose_as_ai(sessions, source_id)
    await asyncio.gather(
        _approve(sessions, query_id),
        _answer(sessions, host_id, DataQueryAnswer(ok=True)),
    )
    with pytest.raises(AppError) as caught:
        await _approve(sessions, query_id)
    assert caught.value.code == "DATA_SOURCE_WRITE_DECIDED"


@pytest.mark.asyncio
async def test_without_writes_the_ai_is_not_offered_the_tool_and_a_call_is_refused(sessions):
    _, source_id = await _seed(sessions, allow_writes=False)
    async with sessions() as db:
        assert "vault_add_task" not in {spec.name for spec in await vault_tools.specs(db)}
        text, is_error = await vault_tools.execute(
            db,
            "vault_add_task",
            {"path": "00_Inbox/TODO.md", "task": "x"},
            requested_by="chat:conv_1",
        )
        assert is_error and "writes_not_allowed" in text
        assert (await db.execute(select(ReviewItem))).first() is None
