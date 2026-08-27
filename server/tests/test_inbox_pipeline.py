import asyncio
import json

import pytest
from models.todo import Todo
from services import inbox_pipeline_service
from sqlalchemy.ext.asyncio import AsyncSession


def _classification_response(**overrides) -> dict:
    classification = {
        "priority": "low",
        "tags": ["ai-tag"],
        "matched_project_folder": "AI Project",
        "project_confidence": 0.99,
        "needs_planning": False,
    }
    classification.update(overrides)
    return {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {
                            "function": {
                                "arguments": json.dumps(classification),
                            }
                        }
                    ]
                }
            }
        ]
    }


async def _create_captured_todo(db_session: AsyncSession) -> Todo:
    todo = Todo(
        id="todo_inbox_pipeline",
        title="Organize this task",
        priority="medium",
        tags=json.dumps(["initial"]),
        source="quick_capture",
        source_id="quick",
        inbox_state="captured",
    )
    db_session.add(todo)
    await db_session.commit()
    return todo


@pytest.mark.asyncio
async def test_slow_classification_discards_stale_result_and_preserves_patch(
    client,
    auth_headers,
    db_session,
):
    todo = await _create_captured_todo(db_session)
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowClassifier:
        async def function_call(self, **_kwargs) -> dict:
            started.set()
            await release.wait()
            return _classification_response()

    async with AsyncSession(
        bind=db_session.bind, expire_on_commit=False
    ) as pipeline_db:
        pipeline_task = asyncio.create_task(
            inbox_pipeline_service.process_todo(
                pipeline_db,
                SlowClassifier(),  # type: ignore[arg-type]
                todo.id,
            )
        )
        try:
            await asyncio.wait_for(started.wait(), timeout=2)
            response = await client.patch(
                f"/api/todos/{todo.id}",
                headers=auth_headers,
                json={
                    "priority": "urgent",
                    "tags": ["user-tag"],
                    "source": "manual",
                    "source_id": "User Project",
                },
            )
            assert response.status_code == 200
        finally:
            release.set()
        await pipeline_task

    fresh = await db_session.get(Todo, todo.id, populate_existing=True)
    assert fresh is not None
    assert fresh.priority == "urgent"
    assert json.loads(fresh.tags or "[]") == ["user-tag"]
    assert fresh.source == "manual"
    assert fresh.source_id == "User Project"
    assert fresh.inbox_state == "error"
    assert fresh.automation_error == inbox_pipeline_service._STALE_CLASSIFICATION_ERROR


@pytest.mark.asyncio
async def test_flush_failure_is_rolled_back_before_recording_pipeline_error(
    db_session,
):
    todo = await _create_captured_todo(db_session)

    class ImmediateClassifier:
        calls = 0

        async def function_call(self, **_kwargs) -> dict:
            self.calls += 1
            return _classification_response()

    classifier = ImmediateClassifier()
    async with AsyncSession(
        bind=db_session.bind, expire_on_commit=False
    ) as pipeline_db:
        original_commit = pipeline_db.commit
        commit_calls = 0

        async def fail_second_commit_during_flush() -> None:
            nonlocal commit_calls
            commit_calls += 1
            if commit_calls == 2:
                pipeline_db.add(Todo(id="todo_invalid_flush", title=None))  # type: ignore[arg-type]
                await pipeline_db.flush()
            await original_commit()

        pipeline_db.commit = fail_second_commit_during_flush  # type: ignore[method-assign]
        await inbox_pipeline_service.process_todo(
            pipeline_db,
            classifier,  # type: ignore[arg-type]
            todo.id,
        )
        assert not pipeline_db.in_transaction()

    fresh = await db_session.get(Todo, todo.id, populate_existing=True)
    assert fresh is not None
    assert classifier.calls == 1
    assert fresh.priority == "medium"
    assert json.loads(fresh.tags or "[]") == ["initial"]
    assert fresh.source == "quick_capture"
    assert fresh.source_id == "quick"
    assert fresh.inbox_state == "error"
    assert fresh.automation_error is not None
    assert "NOT NULL constraint failed" in fresh.automation_error
