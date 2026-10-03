package com.clawchat.android.navigation

/**
 * Screen that shows the item a notification points at.
 *
 * Reminder types come from the server (`reminder_service.py`), the nudge and
 * weekly-review events the WebSocket delivers, and the `run` pushes for agent
 * runs that need the user (`run_push.py`). With an [itemId] a task or run
 * opens on that item; an unknown type returns null so the app simply opens
 * where it was.
 */
fun reminderRoute(reminderType: String?, itemId: String? = null): String? = when (reminderType) {
    "attention" -> NavRoute.Progress.route
    "todo", "todo_overdue" -> NavRoute.Tasks.destination(itemId?.takeIf(String::isNotBlank))
    "nudge" -> NavRoute.Tasks.route
    "run" -> NavRoute.Runs.destination(itemId?.takeIf(String::isNotBlank))
    "event", "weekly_review", "reminder" -> NavRoute.Today.route
    "inbox" -> NavRoute.Inbox.route
    else -> null
}
