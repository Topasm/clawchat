"""Maps internal inbox states to user-facing display values."""

INBOX_STATE_LABELS = {
    "classifying": "Planning now",
    "planning": "Planning now",
    "plan_ready": "Review suggestion",
    "captured": "Needs organizing",
    "error": "Failed",
    "none": None,
}

INBOX_STATE_ACTIONS = {
    "classifying": "wait",
    "planning": "wait",
    "plan_ready": "review",
    "captured": "organize",
    "error": "retry",
    "none": None,
}


def get_display_label(inbox_state: str) -> str | None:
    return INBOX_STATE_LABELS.get(inbox_state)


def get_next_action(inbox_state: str, status: str = "pending") -> str | None:
    if status == "completed":
        return None
    return INBOX_STATE_ACTIONS.get(inbox_state, "execute")
