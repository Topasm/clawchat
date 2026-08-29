package com.clawchat.android.navigation

/**
 * Screen that shows the item a reminder notification points at.
 *
 * Reminder types come from the server (`reminder_service.py`) plus the nudge
 * and weekly-review events the WebSocket delivers. An unknown type returns
 * null so the app simply opens where it was.
 */
fun reminderRoute(reminderType: String?): String? = when (reminderType) {
    "todo", "todo_overdue", "nudge" -> NavRoute.Tasks.route
    "event", "weekly_review" -> NavRoute.Today.route
    "inbox" -> NavRoute.Inbox.route
    else -> null
}
