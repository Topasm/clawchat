from datetime import datetime, timezone

import pytest
from pydantic import ValidationError
from schemas.inbox_triage import InboxTriagePreviewRequest
from services.planning.inbox_deadline import suggest_deadline


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("금요일까지 논문 초안 작성", "2026-09-04"),
        ("이번 주 금요일까지 논문", "2026-09-04"),
        ("다음주 금요일 마감 논문", "2026-09-11"),
        ("Draft by this Friday", "2026-09-04"),
        ("Draft by next Friday", "2026-09-11"),
        ("내일까지 초안", "2026-09-06"),
        ("모레까지 초안", "2026-09-07"),
        ("2026-10-01까지 초안", "2026-10-01"),
    ],
)
def test_dates_are_anchored_to_capture_week_not_refresh(text, expected):
    result = suggest_deadline(
        task_id="t",
        title=text,
        created_at=datetime(2026, 9, 5, tzinfo=timezone.utc),
        timezone_name="Asia/Seoul",
        now=datetime(2026, 9, 20, tzinfo=timezone.utc),
    )
    assert result.local_date.isoformat() == expected
    assert result.due_date.hour == 23
    assert result.due_date.tzinfo is None
    assert result.is_past == (expected < "2026-09-20")


def test_timezone_boundary_and_sqlite_naive_utc_capture():
    captured = datetime(2026, 9, 6, 23, 30)
    results = [
        suggest_deadline(
            task_id="t",
            title="금요일까지 초안",
            created_at=captured,
            timezone_name=zone,
        )
        for zone in ("Asia/Seoul", "America/Los_Angeles")
    ]
    assert [str(item.local_date) for item in results] == ["2026-09-11", "2026-09-04"]


@pytest.mark.parametrize(
    "text",
    [
        "논문 피규어 만들기",
        "금요일 회의",
        "언젠가까지",
        "2026-02-30까지",
        "월요일까지 초안 금요일까지 수정",
    ],
)
def test_ambiguous_or_non_deadline_text_is_not_guessed(text):
    assert (
        suggest_deadline(
            task_id="t",
            title=text,
            created_at=datetime.now(timezone.utc),
            timezone_name="UTC",
        )
        is None
    )


def test_invalid_timezone_is_a_validation_error():
    with pytest.raises(ValidationError):
        InboxTriagePreviewRequest(
            todo_ids=["t"], expected_graph_revision=0, timezone="Not/AZone"
        )
