"""Calendar event recurrence is independent of retired task recurrence."""

from datetime import datetime, timedelta, timezone

from services.calendar.recurrence_service import generate_occurrences, parse_rrule


# --- event expansion -----------------------------------------------------


class FakeEvent:
    def __init__(self, **kwargs):
        self.id = "evt_1"
        self.project_id = None
        self.title = "Standup"
        self.description = None
        self.location = None
        self.is_all_day = False
        self.reminder_minutes = None
        self.recurrence_rule = "FREQ=DAILY"
        self.recurrence_end = None
        self.recurrence_exceptions = None
        self.start_time = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)
        self.end_time = datetime(2026, 8, 28, 9, 30, tzinfo=timezone.utc)
        self.tags = None
        self.created_at = self.start_time
        self.updated_at = self.start_time
        self.__dict__.update(kwargs)


def test_occurrences_exclude_the_base_event():
    event = FakeEvent()

    occurrences = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 8, 31, 23, 59, tzinfo=timezone.utc),
    )

    dates = [o["occurrence_date"] for o in occurrences]
    assert dates == ["2026-08-29", "2026-08-30", "2026-08-31"]


def test_occurrences_keep_the_series_duration():
    event = FakeEvent()

    occurrence = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 8, 29, 23, 59, tzinfo=timezone.utc),
    )[0]

    assert occurrence["end_time"] - occurrence["start_time"] == timedelta(minutes=30)


def test_occurrences_stop_at_recurrence_end():
    event = FakeEvent(recurrence_end=datetime(2026, 8, 30, 23, 59, tzinfo=timezone.utc))

    occurrences = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 9, 30, tzinfo=timezone.utc),
    )

    assert [o["occurrence_date"] for o in occurrences] == ["2026-08-29", "2026-08-30"]


def test_a_naive_range_still_expands_against_an_aware_series():
    """The API layer can hand in naive bounds read back from SQLite."""
    event = FakeEvent()

    occurrences = generate_occurrences(
        event, datetime(2026, 8, 28), datetime(2026, 8, 30, 23, 59)
    )

    assert [o["occurrence_date"] for o in occurrences] == ["2026-08-29", "2026-08-30"]


def test_exception_dates_are_omitted_from_expansion():
    event = FakeEvent(recurrence_exceptions='["2026-08-29"]')

    occurrences = generate_occurrences(
        event,
        datetime(2026, 8, 28, tzinfo=timezone.utc),
        datetime(2026, 8, 30, 23, 59, tzinfo=timezone.utc),
    )

    assert [o["occurrence_date"] for o in occurrences] == ["2026-08-30"]


def test_malformed_rule_expands_to_nothing():
    assert (
        parse_rrule(
            "NOPE",
            datetime(2026, 8, 28, tzinfo=timezone.utc),
            datetime(2026, 8, 28, tzinfo=timezone.utc),
            datetime(2026, 8, 30, tzinfo=timezone.utc),
        )
        == []
    )
