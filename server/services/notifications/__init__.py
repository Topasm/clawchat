"""Everything the server says to the user without being asked.

``reminder_service`` (upcoming events, overdue todos) and ``nudge_service``
(stale tasks) fire from the scheduler; ``briefing_service`` and
``weekly_review_service`` generate the daily and weekly digests, reachable
both from the scheduler and from chat intents; ``push_service`` is the FCM
transport the reminder path hands off to.
"""
