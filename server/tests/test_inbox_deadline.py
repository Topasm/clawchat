from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError
from schemas.inbox_triage import InboxTriagePreviewRequest
from services.planning.inbox_deadline import (
    capture_day,
    due_instant,
    parse_deadline,
    suggest_deadline,
)


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
    assert result.due_date.tzinfo == timezone.utc
    assert result.due_date.astimezone(ZoneInfo("Asia/Seoul")).hour == 23
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
        "언젠가까지",
        "2026-02-30까지",
        "3일 동안 실험",
        "11월 3일부터 11월 5일까지",
        "매주 금요일 회의",
        "목요일까지 이번주 다음주",
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


CAPTURED = datetime(2026, 10, 16, 3, 0, tzinfo=timezone.utc)  # Friday 12:00 in Seoul


@pytest.mark.parametrize(
    ("text", "local_date", "local_time", "title"),
    [
        ("Gpu 컴퓨팅 과제 11월 3일", "2026-11-03", None, "Gpu 컴퓨팅 과제"),
        ("Gpu 컴퓨팅 과제 11/3", "2026-11-03", None, "Gpu 컴퓨팅 과제"),
        ("보고서 10월 2일까지", "2027-10-02", None, "보고서"),
        ("2026년 12월 1일 마감 신청", "2026-12-01", None, "신청"),
        ("세미나 발표 20일까지", "2026-10-20", None, "세미나 발표"),
        ("세미나 발표 3일까지", "2026-11-03", None, "세미나 발표"),
        ("다음 주 화요일 면담", "2026-10-20", None, "면담"),
        ("영어 글쓰기 과제 목요일까지 이번주", "2026-10-15", None, "영어 글쓰기 과제"),
        ("영어 글쓰기 과제 목요일까지 다음주", "2026-10-22", None, "영어 글쓰기 과제"),
        ("미팅 11월 3일 오후 2시", "2026-11-03", "14:00", "미팅"),
        ("미팅 내일 오전 10시 30분", "2026-10-17", "10:30", "미팅"),
        ("Call dentist Nov 3 2pm", "2026-11-03", "14:00", "Call dentist"),
        ("Submit form by tomorrow 14:30", "2026-10-17", "14:30", "Submit form"),
        ("내일 3시간 공부", "2026-10-17", None, "3시간 공부"),
    ],
)
def test_wider_expressions_resolve_and_leave_the_title(text, local_date, local_time, title):
    parsed = parse_deadline(text, capture_day(CAPTURED, "Asia/Seoul"))
    assert parsed is not None
    assert parsed.local_date.isoformat() == local_date
    assert (parsed.local_time.strftime("%H:%M") if parsed.local_time else None) == local_time
    assert parsed.stripped_title == title


def test_a_clock_time_is_the_due_instant():
    parsed = parse_deadline("미팅 11월 3일 오후 2시", date(2026, 10, 16))
    assert due_instant(parsed, "Asia/Seoul") == datetime(2026, 11, 3, 5, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "title, expected_date, expected_time, stripped",
    [
        ("10월 30일 금요일 오후 2시 교수님 면담", date(2026, 10, 30), "14:00", "교수님 면담"),
        ("Oct 30 (Fri) 2pm meeting", date(2026, 10, 30), "14:00", "meeting"),
        ("내일 저녁 7시 회식", date(2026, 10, 25), "19:00", "회식"),
        ("내일 아침 9시 운동", date(2026, 10, 25), "09:00", "운동"),
    ],
)
def test_a_repeated_weekday_and_korean_times_of_day(
    title, expected_date, expected_time, stripped
):
    parsed = parse_deadline(title, date(2026, 10, 24))
    assert parsed is not None, title
    assert parsed.local_date == expected_date
    assert parsed.local_time.strftime("%H:%M") == expected_time
    assert parsed.stripped_title == stripped
