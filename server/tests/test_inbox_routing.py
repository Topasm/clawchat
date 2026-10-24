"""The Inbox files captures by itself, says what it did, and takes it back."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from models.inbox_routing import InboxRouting
from models.note import Note
from models.todo import Todo
from services.planning import inbox_pipeline_service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _next_year_date() -> str:
    """A month-day well ahead of today, so the capture's deadline is upcoming."""
    return (datetime.now(timezone.utc) + timedelta(days=40)).strftime("%-m월 %-d일")


async def _use_utc(client, auth_headers):
    response = await client.put(
        "/api/settings/schedule", headers=auth_headers, json={"timezone": "UTC"}
    )
    assert response.status_code == 200, response.text


async def test_a_phone_capture_with_a_date_is_filed_as_a_task_and_can_be_undone(
    client, auth_headers
):
    await _use_utc(client, auth_headers)
    day = _next_year_date()
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": f"Gpu 컴퓨팅 과제 {day}", "inbox_state": "captured"},
    )
    assert response.status_code == 201, response.text
    todo = response.json()
    assert todo["inbox_state"] == "none"
    assert todo["title"] == "Gpu 컴퓨팅 과제"
    assert todo["due_date"] is not None

    recent = (await client.get("/api/inbox/routings", headers=auth_headers)).json()
    assert recent["auto_organize"] is True
    [routing] = recent["items"]
    assert routing["origin"] == "auto"
    assert routing["kind"] == "task"
    assert routing["original_title"] == f"Gpu 컴퓨팅 과제 {day}"

    undone = await client.post(
        f"/api/inbox/routings/{routing['id']}/undo", headers=auth_headers
    )
    assert undone.status_code == 200, undone.text
    restored = (
        await client.get(f"/api/todos/{todo['id']}", headers=auth_headers)
    ).json()
    assert restored["title"] == f"Gpu 컴퓨팅 과제 {day}"
    assert restored["due_date"] is None
    assert restored["inbox_state"] == "captured"
    assert (await client.get("/api/inbox/routings", headers=auth_headers)).json()[
        "items"
    ] == []


async def test_a_capture_without_a_date_waits_when_there_is_no_ai(client, auth_headers):
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "선택지 만드는 모델 판단 하는 모델", "inbox_state": "captured"},
    )
    assert response.json()["inbox_state"] == "captured"


async def test_turning_auto_organize_off_leaves_dated_captures_alone(
    client, auth_headers
):
    await client.put(
        "/api/settings", headers=auth_headers, json={"inboxAutoOrganize": False}
    )
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": f"과제 {_next_year_date()}", "inbox_state": "captured"},
    )
    assert response.json()["inbox_state"] == "captured"
    assert response.json()["due_date"] is None
    recent = (await client.get("/api/inbox/routings", headers=auth_headers)).json()
    assert recent == {"items": [], "auto_organize": False}


async def test_task_to_note_and_back_keep_their_ids_through_undo(
    client, auth_headers, db_session
):
    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "Lam 신호로 active vision gru 학습",
            "description": "GRU 대신 LSTM도",
            "inbox_state": "captured",
        },
    )
    todo_id = created.json()["id"]

    to_note = await client.post(f"/api/todos/{todo_id}/to-note", headers=auth_headers)
    assert to_note.status_code == 200, to_note.text
    note_id = to_note.json()["note_id"]
    assert to_note.json()["origin"] == "user"
    assert (
        await client.get(f"/api/todos/{todo_id}", headers=auth_headers)
    ).status_code == 404
    [note] = (await client.get("/api/notes", headers=auth_headers)).json()
    assert note["content"] == "Lam 신호로 active vision gru 학습\n\nGRU 대신 LSTM도"

    to_task = await client.post(f"/api/notes/{note_id}/to-task", headers=auth_headers)
    assert to_task.status_code == 200, to_task.text
    new_todo_id = to_task.json()["todo_id"]
    task = (await client.get(f"/api/todos/{new_todo_id}", headers=auth_headers)).json()
    assert task["title"] == "Lam 신호로 active vision gru 학습"
    assert task["description"] == "GRU 대신 LSTM도"
    assert task["inbox_state"] == "none"

    # The note move cannot be undone while the task it became still stands.
    blocked = await client.post(
        f"/api/inbox/routings/{to_note.json()['id']}/undo", headers=auth_headers
    )
    assert blocked.status_code == 409
    assert (
        await client.post(
            f"/api/inbox/routings/{to_task.json()['id']}/undo", headers=auth_headers
        )
    ).status_code == 200
    assert (
        await client.post(
            f"/api/inbox/routings/{to_note.json()['id']}/undo", headers=auth_headers
        )
    ).status_code == 200
    restored = (await client.get(f"/api/todos/{todo_id}", headers=auth_headers)).json()
    assert restored["title"] == "Lam 신호로 active vision gru 학습"
    assert restored["inbox_state"] == "captured"
    assert (await client.get("/api/notes", headers=auth_headers)).json() == []


async def test_a_task_with_steps_cannot_become_a_note(client, auth_headers):
    parent = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Parent", "inbox_state": "captured"},
    )
    await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Step", "parent_id": parent.json()["id"]},
    )
    response = await client.post(
        f"/api/todos/{parent.json()['id']}/to-note", headers=auth_headers
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INBOX_ROUTING_NOT_ALLOWED"


async def test_filing_a_waiting_capture_as_a_task_applies_its_date(
    client, auth_headers
):
    await _use_utc(client, auth_headers)
    await client.put(
        "/api/settings", headers=auth_headers, json={"inboxAutoOrganize": False}
    )
    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": f"신청서 {_next_year_date()}까지", "inbox_state": "captured"},
    )
    filed = await client.post(
        f"/api/todos/{created.json()['id']}/file-as-task", headers=auth_headers
    )
    assert filed.status_code == 200, filed.text
    assert filed.json()["title"] == "신청서"
    assert filed.json()["due_date"] is not None
    again = await client.post(
        f"/api/todos/{created.json()['id']}/file-as-task", headers=auth_headers
    )
    assert again.status_code == 409


async def test_acknowledging_clears_the_just_organized_list(client, auth_headers):
    await _use_utc(client, auth_headers)
    for title in ("A", "B"):
        await client.post(
            "/api/todos",
            headers=auth_headers,
            json={"title": f"{title} {_next_year_date()}", "inbox_state": "captured"},
        )
    cleared = await client.post("/api/inbox/routings/acknowledge", headers=auth_headers)
    assert cleared.json() == {"acknowledged": 2}
    assert (await client.get("/api/inbox/routings", headers=auth_headers)).json()[
        "items"
    ] == []


async def test_just_organized_shows_one_line_per_item(client, auth_headers):
    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Gpu 컴퓨팅 과제", "inbox_state": "captured"},
    )
    todo_id = created.json()["id"]
    to_note = await client.post(f"/api/todos/{todo_id}/to-note", headers=auth_headers)
    to_task = await client.post(
        f"/api/notes/{to_note.json()['note_id']}/to-task", headers=auth_headers
    )

    items = (await client.get("/api/inbox/routings", headers=auth_headers)).json()["items"]
    assert [item["id"] for item in items] == [to_task.json()["id"]]
    # Clearing the list still clears the moves it folded away.
    cleared = await client.post("/api/inbox/routings/acknowledge", headers=auth_headers)
    assert cleared.json() == {"acknowledged": 2}


def _ai(**classification) -> object:
    class Classifier:
        calls: list[str] = []

        async def function_call(self, **kwargs) -> dict:
            self.calls.append(kwargs["user_message"])
            args = {"priority": "medium", "tags": [], "needs_planning": False}
            args.update(classification)
            return {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {"function": {"arguments": json.dumps(args)}}
                            ]
                        }
                    }
                ]
            }

        async def generate_completion(self, *_args, **_kwargs) -> str:
            raise AssertionError("the Inbox must not draft questions by itself")

    return Classifier()


async def _classify(db_session: AsyncSession, title: str, ai) -> str:
    todo = Todo(title=title, inbox_state="classifying")
    db_session.add(todo)
    await db_session.commit()
    async with AsyncSession(
        bind=db_session.bind, expire_on_commit=False
    ) as pipeline_db:
        await inbox_pipeline_service.process_todo(pipeline_db, ai, todo.id)  # type: ignore[arg-type]
    return todo.id


async def test_a_sure_idea_becomes_a_note(db_session):
    todo_id = await _classify(
        db_session,
        "선택지 만드는 모델 판단 하는 모델",
        _ai(kind="note", kind_confidence=0.9),
    )
    assert await db_session.get(Todo, todo_id, populate_existing=True) is None
    note = (await db_session.execute(select(Note))).scalar_one()
    assert note.content == "선택지 만드는 모델 판단 하는 모델"
    routing = (await db_session.execute(select(InboxRouting))).scalar_one()
    assert (routing.origin, routing.kind, routing.todo_id) == ("auto", "note", todo_id)


async def test_a_sure_task_without_a_date_leaves_the_inbox_without_a_plan(db_session):
    todo_id = await _classify(
        db_session,
        "영어 글쓰기 과제 제출",
        _ai(
            kind="task", kind_confidence=0.95, needs_planning=True, tags=["a", "b", "c"]
        ),
    )
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "none"
    assert len(json.loads(todo.tags)) == 2


async def test_an_unsure_capture_is_filed_anyway_and_marked(
    client, auth_headers, db_session
):
    todo_id = await _classify(
        db_session, "GRU 학습", _ai(kind="task", kind_confidence=0.5)
    )
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "none"
    [routing] = (await client.get("/api/inbox/routings", headers=auth_headers)).json()[
        "items"
    ]
    assert (routing["kind"], routing["kind_confidence"]) == ("task", 0.5)


async def test_an_unsure_idea_becomes_a_note_with_its_confidence(db_session):
    await _classify(db_session, "학습 구조 생각", _ai(kind="note", kind_confidence=0.4))
    routing = (await db_session.execute(select(InboxRouting))).scalar_one()
    assert (routing.kind, routing.kind_confidence) == ("note", 0.4)


async def test_a_capture_the_classifier_could_not_read_waits_for_the_user(db_session):
    # No kind at all: the AI failed or answered nothing usable.
    todo_id = await _classify(db_session, "GRU 학습", _ai())
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "captured"
    assert (await db_session.execute(select(InboxRouting))).first() is None


async def test_a_rule_filed_task_has_no_confidence(client, auth_headers):
    await _use_utc(client, auth_headers)
    await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": f"과제 {_next_year_date()}", "inbox_state": "captured"},
    )
    [routing] = (await client.get("/api/inbox/routings", headers=auth_headers)).json()[
        "items"
    ]
    assert routing["kind_confidence"] is None


async def test_the_ai_deadline_is_used_only_when_the_rules_found_none(db_session):
    due = (datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat()
    todo_id = await _classify(
        db_session,
        "발표 자료 준비",
        _ai(kind="task", kind_confidence=0.9, due_date=due),
    )
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "none"
    assert todo.due_date is not None


@pytest.mark.parametrize("past", ["2020-01-01", "not a date"])
async def test_a_past_or_garbled_ai_deadline_is_dropped(db_session, past):
    todo_id = await _classify(
        db_session,
        "발표 자료 준비",
        _ai(kind="task", kind_confidence=0.9, due_date=past),
    )
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "none"
    assert todo.due_date is None


async def test_the_users_own_choices_are_shown_to_the_classifier(
    client, auth_headers, db_session
):
    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "GRU 실험 아이디어", "inbox_state": "captured"},
    )
    await client.post(
        f"/api/todos/{created.json()['id']}/to-note", headers=auth_headers
    )
    ai = _ai(kind="note", kind_confidence=0.5)
    await _classify(db_session, "LSTM 실험 아이디어", ai)
    assert '"GRU 실험 아이디어" -> note' in ai.calls[0]


async def test_a_finished_run_does_not_keep_a_task_from_becoming_a_note(
    client, auth_headers, db_session
):
    from models.agent_task import AgentTask

    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Lam 신호로 active vision gru 학습", "inbox_state": "captured"},
    )
    todo_id = created.json()["id"]
    run = AgentTask(
        task_type="plan",
        instruction="plan it",
        agent_type="plan",
        status="completed",
        todo_id=todo_id,
    )
    db_session.add(run)
    await db_session.commit()

    moved = await client.post(f"/api/todos/{todo_id}/to-note", headers=auth_headers)
    assert moved.status_code == 200, moved.text
    await db_session.refresh(run)
    assert run.todo_id is None

    undone = await client.post(
        f"/api/inbox/routings/{moved.json()['id']}/undo", headers=auth_headers
    )
    assert undone.status_code == 200, undone.text
    await db_session.refresh(run)
    assert run.todo_id == todo_id


async def test_a_running_agent_keeps_the_task_and_says_why(
    client, auth_headers, db_session
):
    from models.agent_task import AgentTask

    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Busy", "inbox_state": "captured"},
    )
    todo_id = created.json()["id"]
    db_session.add(
        AgentTask(
            task_type="plan",
            instruction="x",
            agent_type="plan",
            status="running",
            todo_id=todo_id,
        )
    )
    await db_session.commit()
    response = await client.post(f"/api/todos/{todo_id}/to-note", headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["error"]["message"] == (
        "This task cannot become a note: an agent run on it is still going"
    )


# ---------------------------------------------------------------------------
# Events, clock times, and long memos
# ---------------------------------------------------------------------------


def _local(moment: datetime, zone) -> datetime:
    return moment.replace(tzinfo=moment.tzinfo or timezone.utc).astimezone(zone)


async def _zone(db_session):
    from services.notifications import schedule_settings

    return (await schedule_settings.load(db_session)).zone


async def test_an_appointment_at_a_clock_time_becomes_an_event(
    client, auth_headers, db_session
):
    from models.event import Event

    typed = f"{_next_year_date()} 오후 2시 교수님 면담"
    todo_id = await _classify(
        db_session, typed, _ai(kind="event", kind_confidence=0.9, location="연구실")
    )
    assert await db_session.get(Todo, todo_id, populate_existing=True) is None
    event = (await db_session.execute(select(Event))).scalar_one()
    zone = await _zone(db_session)
    assert event.title == "교수님 면담"
    assert event.description == typed  # the text as typed is kept
    assert event.location == "연구실"
    assert event.is_all_day is False
    start = _local(event.start_time, zone)
    assert (start.hour, start.minute) == (14, 0)
    assert _local(event.end_time, zone) - start == timedelta(hours=1)

    [routing] = (await client.get("/api/inbox/routings", headers=auth_headers)).json()[
        "items"
    ]
    assert (routing["kind"], routing["todo_id"], routing["event_id"]) == (
        "event",
        todo_id,
        event.id,
    )
    assert routing["original_title"] == typed
    assert routing["title"] == "교수님 면담"

    undone = await client.post(
        f"/api/inbox/routings/{routing['id']}/undo", headers=auth_headers
    )
    assert undone.status_code == 200, undone.text
    assert (await db_session.execute(select(Event))).first() is None
    restored = (await client.get(f"/api/todos/{todo_id}", headers=auth_headers)).json()
    assert (restored["title"], restored["inbox_state"]) == (typed, "captured")
    assert restored["description"] is None
    assert (await client.get("/api/admin/stats", headers=auth_headers)).status_code in (
        200,
        404,
    )


async def test_something_due_at_a_clock_time_stays_a_task_with_that_time(
    client, auth_headers, db_session
):
    typed = f"{_next_year_date()} 오후 2시까지 보고서 제출"
    todo_id = await _classify(db_session, typed, _ai(kind="task", kind_confidence=0.9))
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "none"
    assert todo.title == "보고서 제출"
    assert todo.description == typed
    due = _local(todo.due_date, await _zone(db_session))
    assert (due.hour, due.minute) == (14, 0)


async def test_a_clock_time_is_filed_as_a_task_at_once_without_an_ai(
    client, auth_headers
):
    """No classifier to ask whether it is an appointment: the rules file it."""
    await _use_utc(client, auth_headers)
    typed = f"보고서 제출 {_next_year_date()} 오후 2시"
    response = await client.post(
        "/api/todos", headers=auth_headers, json={"title": typed, "inbox_state": "captured"}
    )
    todo = response.json()
    assert todo["inbox_state"] == "none"
    assert todo["title"] == "보고서 제출"
    assert todo["description"] == typed
    assert todo["due_date"].endswith("T14:00:00Z")


async def test_a_long_memo_gets_a_short_title_and_keeps_its_text(db_session):
    memo = (
        "랩미팅 발표 준비: Diffusion Policy 논문 다시 읽고 실험 결과 정리하기, "
        "교수님께 보낼 요약 초안 쓰기, 데이터셋 전처리 스크립트 고치기, "
        "다음 주 세미나 일정 확인하고 회의실 예약하기"
    )
    assert len(memo) > 80
    todo_id = await _classify(
        db_session, memo, _ai(kind="task", kind_confidence=0.9, title="랩미팅 발표 준비")
    )
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.title == "랩미팅 발표 준비"
    assert todo.description == memo

    # A short capture is its own title: the classifier's title is ignored.
    short_id = await _classify(
        db_session, "GRU 학습", _ai(kind="task", kind_confidence=0.9, title="학습")
    )
    short = await db_session.get(Todo, short_id, populate_existing=True)
    assert (short.title, short.description) == ("GRU 학습", None)


async def test_an_event_without_a_clock_time_is_a_task_due_that_day(db_session):
    day = (datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat()
    todo_id = await _classify(
        db_session,
        "교수님 면담",
        _ai(kind="event", kind_confidence=0.9, start_time=day),
    )
    todo = await db_session.get(Todo, todo_id, populate_existing=True)
    assert todo.inbox_state == "none"
    assert todo.due_date is not None


async def test_an_event_from_the_classifiers_own_time_undoes_to_the_capture(
    client, auth_headers, db_session
):
    from models.event import Event

    start = (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%dT10:30")
    todo_id = await _classify(
        db_session,
        "weekly sync with Minji",
        _ai(kind="event", kind_confidence=0.8, start_time=start),
    )
    event = (await db_session.execute(select(Event))).scalar_one()
    assert event.title == "weekly sync with Minji"
    assert event.description is None
    assert _local(event.start_time, await _zone(db_session)).strftime("%H:%M") == "10:30"
    [routing] = (await client.get("/api/inbox/routings", headers=auth_headers)).json()[
        "items"
    ]
    assert (routing["kind"], routing["kind_confidence"], routing["todo_id"]) == (
        "event",
        0.8,
        todo_id,
    )


async def test_a_task_becomes_an_event_and_back_from_the_row(
    client, auth_headers, db_session
):
    await _use_utc(client, auth_headers)
    created = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "치과", "due_date": "2027-03-04T23:59:59Z", "inbox_state": "none"},
    )
    todo_id = created.json()["id"]

    to_event = await client.post(f"/api/todos/{todo_id}/to-event", headers=auth_headers)
    assert to_event.status_code == 200, to_event.text
    event_id = to_event.json()["event_id"]
    assert to_event.json()["kind"] == "event"
    event = (await client.get(f"/api/events/{event_id}", headers=auth_headers)).json()
    # A deadline with no clock time is an all-day event on that day.
    assert event["is_all_day"] is True
    assert event["start_time"] == "2027-03-04T00:00:00Z"
    assert (await client.get(f"/api/todos/{todo_id}", headers=auth_headers)).status_code == 404

    to_task = await client.post(f"/api/events/{event_id}/to-task", headers=auth_headers)
    assert to_task.status_code == 200, to_task.text
    new_todo = (
        await client.get(f"/api/todos/{to_task.json()['todo_id']}", headers=auth_headers)
    ).json()
    assert new_todo["title"] == "치과"
    assert new_todo["due_date"] == "2027-03-04T23:59:59Z"
    assert (await client.get(f"/api/events/{event_id}", headers=auth_headers)).status_code == 404

    # The event move cannot be undone while the task it became still stands.
    blocked = await client.post(
        f"/api/inbox/routings/{to_event.json()['id']}/undo", headers=auth_headers
    )
    assert blocked.status_code == 409
    undone = await client.post(
        f"/api/inbox/routings/{to_task.json()['id']}/undo", headers=auth_headers
    )
    assert undone.status_code == 200, undone.text
    assert (await client.get(f"/api/events/{event_id}", headers=auth_headers)).status_code == 200
    undone = await client.post(
        f"/api/inbox/routings/{to_event.json()['id']}/undo", headers=auth_headers
    )
    assert undone.status_code == 200, undone.text
    back = (await client.get(f"/api/todos/{todo_id}", headers=auth_headers)).json()
    assert back["due_date"] == "2027-03-04T23:59:59Z"

    # Each item is one line under "Just organized" even after several moves.
    recent = (await client.get("/api/inbox/routings", headers=auth_headers)).json()
    assert recent["items"] == []


async def test_a_task_without_a_date_cannot_become_an_event(client, auth_headers):
    created = await client.post(
        "/api/todos", headers=auth_headers, json={"title": "언젠가", "inbox_state": "none"}
    )
    response = await client.post(
        f"/api/todos/{created.json()['id']}/to-event", headers=auth_headers
    )
    assert response.status_code == 409
    assert "date or time" in response.json()["error"]["message"]
