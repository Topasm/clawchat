"""Calendar events and the scheduling maths around them.

``calendar_service`` is event CRUD plus iCal export, ``recurrence_service`` is
RRULE parsing and occurrence expansion (also used by todos and reminders), and
``scheduling_service`` does conflict detection, free-slot finding and AI time
suggestions.
"""
