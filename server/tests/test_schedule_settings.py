"""The briefing / weekly review schedule is editable and takes effect at once."""

import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

from services import scheduler as scheduler_module
from services.notifications import briefing_service, schedule_settings


@pytest.mark.asyncio
async def test_defaults_come_from_the_environment(
    client: AsyncClient, auth_headers: dict
):
    resp = await client.get("/api/settings/schedule", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    env = schedule_settings.defaults_from_env()
    assert body["briefing_time"] == env.briefing_time
    assert body["weekly_review_day"] == env.weekly_review_day
    assert body["effective_timezone"]
    assert body["next_briefing_at"].endswith("Z")


@pytest.mark.asyncio
async def test_saved_schedule_is_read_in_the_users_zone(
    client: AsyncClient, auth_headers: dict
):
    resp = await client.put(
        "/api/settings/schedule",
        json={
            "briefing_time": "07:30",
            "timezone": "Asia/Seoul",
            "weekly_review_enabled": True,
            "weekly_review_day": "Tuesday",
            "weekly_review_time": "18:00",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["weekly_review_day"] == "tuesday"
    assert body["effective_timezone"] == "Asia/Seoul"

    seoul = ZoneInfo("Asia/Seoul")
    next_briefing = datetime.fromisoformat(
        body["next_briefing_at"].replace("Z", "+00:00")
    )
    assert next_briefing.astimezone(seoul).strftime("%H:%M") == "07:30"
    assert next_briefing > datetime.now(timezone.utc)
    next_review = datetime.fromisoformat(
        body["next_weekly_review_at"].replace("Z", "+00:00")
    )
    local_review = next_review.astimezone(seoul)
    assert (local_review.weekday(), local_review.strftime("%H:%M")) == (1, "18:00")

    # A later partial update keeps the rest.
    resp = await client.put(
        "/api/settings/schedule", json={"briefing_enabled": False}, headers=auth_headers
    )
    body = resp.json()
    assert body["briefing_enabled"] is False
    assert body["next_briefing_at"] is None
    assert body["briefing_time"] == "07:30"

    # It lives in the ordinary settings bag, next to the other preferences.
    stored = (await client.get("/api/settings", headers=auth_headers)).json()[
        "settings"
    ]
    assert stored["schedule"]["timezone"] == "Asia/Seoul"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"briefing_time": "25:00"},
        {"briefing_time": "8am"},
        {"weekly_review_day": "someday"},
        {"timezone": "Mars/Olympus"},
    ],
)
async def test_bad_values_are_rejected(
    client: AsyncClient, auth_headers: dict, payload
):
    resp = await client.put(
        "/api/settings/schedule", json=payload, headers=auth_headers
    )
    assert resp.status_code == 422


class _Sockets:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, _user_id: str, payload: dict) -> None:
        self.sent.append(payload)


@pytest.mark.asyncio
async def test_briefing_loop_follows_a_change_without_restart(
    client: AsyncClient, auth_headers: dict, session_factory, monkeypatch
):
    """Switched off, the loop idles; switched on, it plans again at once."""
    await client.put(
        "/api/settings/schedule", json={"briefing_enabled": False}, headers=auth_headers
    )

    async def fake_briefing(_db, _ai):
        return "Good morning"

    monkeypatch.setattr(briefing_service, "generate_briefing", fake_briefing)
    monkeypatch.setattr(
        scheduler_module,
        "next_daily_occurrence",
        lambda now, _clock, _zone: now + timedelta(milliseconds=50),
    )
    sockets = _Sockets()
    sched = scheduler_module.Scheduler(session_factory, None, sockets)  # type: ignore[arg-type]
    task = asyncio.create_task(sched._briefing_loop())
    try:
        await asyncio.sleep(0.3)
        assert sockets.sent == []  # off: nothing fires even though "now" is due

        resp = await client.put(
            "/api/settings/schedule",
            json={"briefing_enabled": True},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        for _ in range(40):
            if sockets.sent:
                break
            await asyncio.sleep(0.05)
        assert sockets.sent and sockets.sent[0]["type"] == "daily_briefing"
        assert sockets.sent[0]["data"]["content"] == "Good morning"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert not schedule_settings._listeners  # the loop unsubscribed on cancel
