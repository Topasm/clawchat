"""API and compatibility coverage for normalized task relationships."""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from auth.dependencies import get_current_user
from database import Base, _setup_task_relationship_integrity, get_db
from domain.task import TaskStatus
from domain.task_relationship import TaskRelationshipType
from exceptions import ValidationError
from main import app
from models.task_relationship import TaskRelationship
from models.todo import Todo
from services.task_relationship_service import (
    _assert_dependency_dag,
    replace_task_dependencies,
)
from ws import notifications as ws_notifications


async def _create_todo(client, auth_headers, title: str, **payload) -> dict:
    response = await client.post(
        "/api/todos",
        json={"title": title, **payload},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _create_relationship(
    client,
    auth_headers,
    source_task_id: str,
    target_task_id: str,
    relationship_type: str = "depends_on",
    **payload,
) -> dict:
    response = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": source_task_id,
            "target_task_id": target_task_id,
            "type": relationship_type,
            **payload,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_dependency_validation_handles_graphs_deeper_than_python_recursion_limit():
    edges = [
        (f"todo_{index:04d}", f"todo_{index + 1:04d}")
        for index in range(2000)
    ]

    _assert_dependency_dag(edges)
    with pytest.raises(ValidationError, match="Dependency cycle detected"):
        _assert_dependency_dag([*edges, ("todo_2000", "todo_0000")])


@pytest.mark.asyncio
async def test_sqlite_triggers_reject_direct_insert_and_update_cycles(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'direct-cycle.db'}"
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as session:
        session.add_all(
            [
                Todo(id="todo_a", title="A"),
                Todo(id="todo_b", title="B"),
                Todo(id="todo_c", title="C"),
            ]
        )
        await session.commit()
        await _setup_task_relationship_integrity(session)
        session.add_all(
            [
                TaskRelationship(
                    id="rel_ab",
                    source_task_id="todo_a",
                    target_task_id="todo_b",
                    type=TaskRelationshipType.DEPENDS_ON,
                ),
                TaskRelationship(
                    id="rel_bc",
                    source_task_id="todo_b",
                    target_task_id="todo_c",
                    type=TaskRelationshipType.DEPENDS_ON,
                ),
            ]
        )
        await session.commit()

        session.add(
            TaskRelationship(
                id="rel_ca",
                source_task_id="todo_c",
                target_task_id="todo_a",
                type=TaskRelationshipType.DEPENDS_ON,
            )
        )
        with pytest.raises(IntegrityError, match="dependency cycle detected"):
            await session.commit()
        await session.rollback()

        related = TaskRelationship(
            id="rel_ca_related",
            source_task_id="todo_c",
            target_task_id="todo_a",
            type=TaskRelationshipType.RELATED,
        )
        session.add(related)
        await session.commit()
        related.type = TaskRelationshipType.DEPENDS_ON
        with pytest.raises(IntegrityError, match="dependency cycle detected"):
            await session.commit()
        await session.rollback()

    await engine.dispose()


@pytest.mark.asyncio
async def test_sqlite_trigger_serializes_concurrent_reverse_dependency_inserts(
    tmp_path,
):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'concurrent-cycle.db'}",
        connect_args={"timeout": 30},
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with session_factory() as setup_session:
        setup_session.add_all(
            [
                Todo(id="todo_left", title="Left"),
                Todo(id="todo_right", title="Right"),
            ]
        )
        await setup_session.commit()
        await _setup_task_relationship_integrity(setup_session)

    barrier = asyncio.Barrier(2)

    async def insert_edge(
        relationship_id: str,
        source_task_id: str,
        target_task_id: str,
    ) -> str:
        async with session_factory() as session:
            session.add(
                TaskRelationship(
                    id=relationship_id,
                    source_task_id=source_task_id,
                    target_task_id=target_task_id,
                    type=TaskRelationshipType.DEPENDS_ON,
                )
            )
            await barrier.wait()
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                assert "dependency cycle detected" in str(exc)
                return "cycle"
            return "created"

    results = await asyncio.gather(
        insert_edge("rel_left_right", "todo_left", "todo_right"),
        insert_edge("rel_right_left", "todo_right", "todo_left"),
    )
    assert sorted(results) == ["created", "cycle"]

    async with session_factory() as session:
        relationships = list(
            (await session.execute(select(TaskRelationship))).scalars().all()
        )
        assert len(relationships) == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_relationship_crud_filters_and_dependency_shadow(client, auth_headers):
    prerequisite = await _create_todo(client, auth_headers, "Prerequisite")
    replacement = await _create_todo(client, auth_headers, "Replacement")
    task = await _create_todo(client, auth_headers, "Execute")

    relationship = await _create_relationship(
        client,
        auth_headers,
        task["id"],
        prerequisite["id"],
        label="must finish first",
    )
    assert relationship["type"] == "depends_on"
    assert relationship["created_by"] == "user"
    assert relationship["proposal_id"] is None

    by_source = await client.get(
        "/api/task-relationships",
        params={"source_task_id": task["id"], "type": "depends_on"},
        headers=auth_headers,
    )
    assert by_source.status_code == 200
    assert [item["id"] for item in by_source.json()] == [relationship["id"]]

    by_task = await client.get(
        "/api/task-relationships",
        params={"task_id": prerequisite["id"]},
        headers=auth_headers,
    )
    assert [item["id"] for item in by_task.json()] == [relationship["id"]]

    todo_response = await client.get(
        f"/api/todos/{task['id']}",
        headers=auth_headers,
    )
    assert todo_response.json()["depends_on"] == [prerequisite["id"]]

    patch_response = await client.patch(
        f"/api/task-relationships/{relationship['id']}",
        json={
            "target_task_id": replacement["id"],
            "label": None,
        },
        headers=auth_headers,
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["target_task_id"] == replacement["id"]
    assert patch_response.json()["label"] is None

    todo_response = await client.get(
        f"/api/todos/{task['id']}",
        headers=auth_headers,
    )
    assert todo_response.json()["depends_on"] == [replacement["id"]]

    rewire_response = await client.patch(
        f"/api/task-relationships/{relationship['id']}",
        json={
            "source_task_id": replacement["id"],
            "target_task_id": prerequisite["id"],
        },
        headers=auth_headers,
    )
    assert rewire_response.status_code == 200
    assert rewire_response.json()["source_task_id"] == replacement["id"]
    assert rewire_response.json()["target_task_id"] == prerequisite["id"]
    old_source_response = await client.get(
        f"/api/todos/{task['id']}",
        headers=auth_headers,
    )
    assert old_source_response.json()["depends_on"] is None
    new_source_response = await client.get(
        f"/api/todos/{replacement['id']}",
        headers=auth_headers,
    )
    assert new_source_response.json()["depends_on"] == [prerequisite["id"]]

    related_response = await client.patch(
        f"/api/task-relationships/{relationship['id']}",
        json={"type": "related"},
        headers=auth_headers,
    )
    assert related_response.status_code == 200
    assert related_response.json()["type"] == "related"
    todo_response = await client.get(
        f"/api/todos/{replacement['id']}",
        headers=auth_headers,
    )
    assert todo_response.json()["depends_on"] is None

    delete_response = await client.delete(
        f"/api/task-relationships/{relationship['id']}",
        headers=auth_headers,
    )
    assert delete_response.status_code == 204
    assert (
        await client.get("/api/task-relationships", headers=auth_headers)
    ).json() == []


@pytest.mark.asyncio
async def test_relationship_validation_rejects_invalid_graph(client, auth_headers):
    task_a = await _create_todo(client, auth_headers, "A")
    task_b = await _create_todo(client, auth_headers, "B")
    task_c = await _create_todo(client, auth_headers, "C")

    await _create_relationship(client, auth_headers, task_a["id"], task_b["id"])
    await _create_relationship(client, auth_headers, task_b["id"], task_c["id"])

    duplicate = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": task_a["id"],
            "target_task_id": task_b["id"],
            "type": "depends_on",
        },
        headers=auth_headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "CONFLICT"

    self_edge = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": task_a["id"],
            "target_task_id": task_a["id"],
            "type": "related",
        },
        headers=auth_headers,
    )
    assert self_edge.status_code == 422

    dangling = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": task_a["id"],
            "target_task_id": "todo_missing",
            "type": "related",
        },
        headers=auth_headers,
    )
    assert dangling.status_code == 400

    cycle = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": task_c["id"],
            "target_task_id": task_a["id"],
            "type": "depends_on",
        },
        headers=auth_headers,
    )
    assert cycle.status_code == 400
    assert "cycle" in cycle.json()["error"]["message"].lower()

    # Non-ordering edge types do not participate in DAG cycle validation.
    related = await _create_relationship(
        client,
        auth_headers,
        task_c["id"],
        task_a["id"],
        "related",
    )
    assert related["type"] == "related"

    cycle_patch = await client.patch(
        f"/api/task-relationships/{related['id']}",
        json={"type": "depends_on"},
        headers=auth_headers,
    )
    assert cycle_patch.status_code == 400

    parallel_type = await _create_relationship(
        client,
        auth_headers,
        task_a["id"],
        task_b["id"],
        "related",
    )
    duplicate_patch = await client.patch(
        f"/api/task-relationships/{parallel_type['id']}",
        json={"type": "depends_on"},
        headers=auth_headers,
    )
    assert duplicate_patch.status_code == 409


@pytest.mark.parametrize(
    "field",
    ["source_task_id", "target_task_id", "type"],
)
@pytest.mark.asyncio
async def test_relationship_patch_rejects_null_required_fields(
    client,
    auth_headers,
    field: str,
):
    source = await _create_todo(client, auth_headers, "Source")
    target = await _create_todo(client, auth_headers, "Target")
    relationship = await _create_relationship(
        client,
        auth_headers,
        source["id"],
        target["id"],
        "related",
    )

    response = await client.patch(
        f"/api/task-relationships/{relationship['id']}",
        json={field: None},
        headers=auth_headers,
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["source_task_id", "target_task_id"])
@pytest.mark.asyncio
async def test_relationship_mutations_reject_whitespace_identifiers(
    client,
    auth_headers,
    field: str,
):
    source = await _create_todo(client, auth_headers, "Source")
    target = await _create_todo(client, auth_headers, "Target")
    payload = {
        "source_task_id": source["id"],
        "target_task_id": target["id"],
        "type": "related",
    }
    payload[field] = "   "

    response = await client.post(
        "/api/task-relationships",
        json=payload,
        headers=auth_headers,
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["created_by", "proposal_id"])
@pytest.mark.asyncio
async def test_relationship_api_rejects_client_supplied_provenance(
    client,
    auth_headers,
    field: str,
):
    source = await _create_todo(client, auth_headers, "Source")
    target = await _create_todo(client, auth_headers, "Target")
    create_response = await client.post(
        "/api/task-relationships",
        json={
            "source_task_id": source["id"],
            "target_task_id": target["id"],
            "type": "related",
            field: "forged",
        },
        headers=auth_headers,
    )
    assert create_response.status_code == 422

    relationship = await _create_relationship(
        client,
        auth_headers,
        source["id"],
        target["id"],
        "related",
    )
    patch_response = await client.patch(
        f"/api/task-relationships/{relationship['id']}",
        json={field: "forged"},
        headers=auth_headers,
    )
    assert patch_response.status_code == 422


@pytest.mark.asyncio
async def test_todo_delete_cascades_edges_and_repairs_dependency_shadows(
    client,
    auth_headers,
    db_session: AsyncSession,
):
    prerequisite = await _create_todo(client, auth_headers, "Delete me")
    dependent = await _create_todo(client, auth_headers, "Dependent")
    related = await _create_todo(client, auth_headers, "Related")
    await _create_relationship(
        client,
        auth_headers,
        dependent["id"],
        prerequisite["id"],
    )
    await _create_relationship(
        client,
        auth_headers,
        related["id"],
        prerequisite["id"],
        "related",
    )

    delete_response = await client.delete(
        f"/api/todos/{prerequisite['id']}",
        headers=auth_headers,
    )
    assert delete_response.status_code == 204

    relationship_rows = list(
        (await db_session.execute(select(TaskRelationship))).scalars().all()
    )
    assert relationship_rows == []
    dependent_row = await db_session.get(Todo, dependent["id"])
    await db_session.refresh(dependent_row)
    assert dependent_row.depends_on is None


@pytest.mark.asyncio
async def test_bulk_todo_delete_cascades_edges_and_repairs_dependency_shadow(
    client,
    auth_headers,
):
    prerequisite = await _create_todo(client, auth_headers, "Bulk delete me")
    dependent = await _create_todo(client, auth_headers, "Bulk dependent")
    await _create_relationship(
        client,
        auth_headers,
        dependent["id"],
        prerequisite["id"],
    )

    response = await client.patch(
        "/api/todos/bulk",
        json={"ids": [prerequisite["id"]], "delete": True},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"updated": 0, "deleted": 1, "errors": []}
    relationships = await client.get(
        "/api/task-relationships",
        params={"source_task_id": dependent["id"]},
        headers=auth_headers,
    )
    assert relationships.status_code == 200
    assert relationships.json() == []
    dependent_response = await client.get(
        f"/api/todos/{dependent['id']}",
        headers=auth_headers,
    )
    assert dependent_response.status_code == 200
    assert dependent_response.json()["depends_on"] is None


@pytest.mark.asyncio
async def test_admin_purge_cascades_edges_and_repairs_dependency_shadow(
    client,
    auth_headers,
    db_session: AsyncSession,
    monkeypatch,
):
    prerequisite = await _create_todo(client, auth_headers, "Purge me")
    dependent = await _create_todo(client, auth_headers, "Purge dependent")
    await _create_relationship(
        client,
        auth_headers,
        dependent["id"],
        prerequisite["id"],
    )
    prerequisite_row = await db_session.get(Todo, prerequisite["id"])
    assert prerequisite_row is not None
    prerequisite_row.status = TaskStatus.COMPLETED
    prerequisite_row.completed_at = datetime.now(timezone.utc) - timedelta(days=10)
    await db_session.commit()
    send_json = AsyncMock()
    monkeypatch.setattr(ws_notifications.ws_manager, "send_json", send_json)

    response = await client.post(
        "/api/admin/db/purge",
        json={"target": "todos", "older_than_days": 1},
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"deleted_count": 1, "target": "todos"}
    relationships = await client.get(
        "/api/task-relationships",
        params={"source_task_id": dependent["id"]},
        headers=auth_headers,
    )
    assert relationships.status_code == 200
    assert relationships.json() == []
    dependent_response = await client.get(
        f"/api/todos/{dependent['id']}",
        headers=auth_headers,
    )
    assert dependent_response.status_code == 200
    assert dependent_response.json()["depends_on"] is None
    send_json.assert_awaited_once_with(
        "user",
        {
            "type": "module_data_changed",
            "data": {"module": "todos"},
        },
    )

    send_json.reset_mock()
    empty_response = await client.post(
        "/api/admin/db/purge",
        json={"target": "todos", "older_than_days": 1},
        headers=auth_headers,
    )
    assert empty_response.status_code == 200
    assert empty_response.json() == {"deleted_count": 0, "target": "todos"}
    send_json.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_duplicate_relationship_posts_return_one_201_and_conflicts(
    tmp_path,
):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'duplicate-posts.db'}",
        pool_size=1,
        max_overflow=0,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with session_factory() as session:
            yield session

    async def override_user() -> str:
        return "user"

    original_db_override = app.dependency_overrides.get(get_db)
    original_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as api:
            source = await _create_todo(api, {}, "Concurrent source")
            target = await _create_todo(api, {}, "Concurrent target")
            payload = {
                "source_task_id": source["id"],
                "target_task_id": target["id"],
                "type": "related",
            }
            responses = await asyncio.gather(
                *(api.post("/api/task-relationships", json=payload) for _ in range(4))
            )

            assert sorted(response.status_code for response in responses) == [
                201,
                409,
                409,
                409,
            ]
            for response in responses:
                if response.status_code == 409:
                    assert response.json()["error"]["code"] == "CONFLICT"
            list_response = await api.get("/api/task-relationships")
            assert list_response.status_code == 200
            assert len(list_response.json()) == 1
    finally:
        if original_db_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = original_db_override
        if original_user_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = original_user_override
        await engine.dispose()


@pytest.mark.asyncio
async def test_legacy_todo_dependency_writes_replace_normalized_edges(
    client,
    auth_headers,
):
    prerequisite = await _create_todo(client, auth_headers, "First")
    replacement = await _create_todo(client, auth_headers, "Second")
    task = await _create_todo(
        client,
        auth_headers,
        "Legacy client",
        depends_on=[prerequisite["id"]],
    )
    assert task["depends_on"] == [prerequisite["id"]]

    relationships = (
        await client.get(
            "/api/task-relationships",
            params={"source_task_id": task["id"], "type": "depends_on"},
            headers=auth_headers,
        )
    ).json()
    assert [item["target_task_id"] for item in relationships] == [
        prerequisite["id"]
    ]

    update_response = await client.patch(
        f"/api/todos/{task['id']}",
        json={"depends_on": [replacement["id"]]},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["depends_on"] == [replacement["id"]]

    relationships = (
        await client.get(
            "/api/task-relationships",
            params={"source_task_id": task["id"]},
            headers=auth_headers,
        )
    ).json()
    assert [item["target_task_id"] for item in relationships] == [
        replacement["id"]
    ]

    cycle = await client.patch(
        f"/api/todos/{replacement['id']}",
        json={"depends_on": [task["id"]]},
        headers=auth_headers,
    )
    assert cycle.status_code == 400

    duplicate = await client.patch(
        f"/api/todos/{task['id']}",
        json={"depends_on": [prerequisite["id"], prerequisite["id"]]},
        headers=auth_headers,
    )
    assert duplicate.status_code == 400

    clear_response = await client.patch(
        f"/api/todos/{task['id']}",
        json={"depends_on": []},
        headers=auth_headers,
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["depends_on"] is None


@pytest.mark.asyncio
async def test_legacy_dependency_replace_preserves_retained_edge_metadata(
    client,
    auth_headers,
    db_session: AsyncSession,
):
    prerequisite = await _create_todo(client, auth_headers, "Existing prerequisite")
    added_prerequisite = await _create_todo(client, auth_headers, "New prerequisite")
    task = await _create_todo(client, auth_headers, "Planned task")

    relationships = await replace_task_dependencies(
        db_session,
        task["id"],
        [prerequisite["id"]],
        created_by="ai",
        proposal_id="plan_keep_metadata",
    )
    retained = relationships[0]
    retained.label = "AI rationale"
    await db_session.commit()
    await db_session.refresh(retained)
    original_values = {
        "id": retained.id,
        "label": retained.label,
        "created_by": retained.created_by,
        "proposal_id": retained.proposal_id,
        "created_at": retained.created_at,
        "updated_at": retained.updated_at,
    }

    response = await client.patch(
        f"/api/todos/{task['id']}",
        json={
            "depends_on": [
                prerequisite["id"],
                added_prerequisite["id"],
            ]
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    await db_session.refresh(retained)
    assert {
        "id": retained.id,
        "label": retained.label,
        "created_by": retained.created_by,
        "proposal_id": retained.proposal_id,
        "created_at": retained.created_at,
        "updated_at": retained.updated_at,
    } == original_values
    rows = list(
        (
            await db_session.execute(
                select(TaskRelationship).where(
                    TaskRelationship.source_task_id == task["id"],
                    TaskRelationship.type == TaskRelationshipType.DEPENDS_ON,
                )
            )
        ).scalars().all()
    )
    added = next(
        row
        for row in rows
        if row.target_task_id == added_prerequisite["id"]
    )
    assert added.created_by == "user"
    assert added.proposal_id is None


def test_openapi_exposes_named_task_relationship_type_component():
    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]
    relationship_type_schema = schemas[
        "TaskRelationshipType"
    ]

    assert relationship_type_schema["type"] == "string"
    assert relationship_type_schema["enum"] == [
        relationship_type.value for relationship_type in TaskRelationshipType
    ]

    create_properties = schemas["TaskRelationshipCreate"]["properties"]
    update_schema = schemas["TaskRelationshipUpdate"]
    update_properties = update_schema["properties"]
    assert "created_by" not in create_properties
    assert "proposal_id" not in create_properties
    assert "created_by" not in update_properties
    assert "proposal_id" not in update_properties
    for field_name in ("source_task_id", "target_task_id", "type"):
        assert field_name not in update_schema.get("required", [])
        assert {"type": "null"} not in update_properties[field_name].get(
            "anyOf", []
        )
    assert {"type": "null"} in update_properties["label"]["anyOf"]

    relationship_paths = openapi["paths"]["/api/task-relationships"]
    item_paths = openapi["paths"]["/api/task-relationships/{relationship_id}"]
    for operation, status_codes in (
        (relationship_paths["post"], ("400", "409")),
        (item_paths["patch"], ("400", "404", "409")),
        (item_paths["delete"], ("404",)),
    ):
        for status_code in status_codes:
            schema = operation["responses"][status_code]["content"][
                "application/json"
            ]["schema"]
            assert schema == {"$ref": "#/components/schemas/ErrorResponse"}

    plan_apply_schema = openapi["paths"]["/api/todos/{todo_id}/plan/apply"][
        "post"
    ]["responses"]["200"]["content"]["application/json"]["schema"]
    assert plan_apply_schema == {
        "$ref": "#/components/schemas/PlanApplyResponse"
    }
    assert schemas["TodoCreate"]["properties"]["depends_on"]["deprecated"] is True
    assert schemas["TodoUpdate"]["properties"]["depends_on"]["deprecated"] is True
