package com.clawchat.android.navigation

import android.net.Uri

/** Sealed hierarchy of all navigation destinations in the app. */
sealed class NavRoute(val route: String) {
    data object Onboarding : NavRoute("onboarding")
    data object Today : NavRoute("today")
    data object Calendar : NavRoute("calendar")
    data object Chat : NavRoute("chat") {
        const val ARG_TITLE = "context_title"
        const val ARG_CONVERSATION_ID = "conversation_id"
        val routePattern = "$route?$ARG_CONVERSATION_ID={$ARG_CONVERSATION_ID}&$ARG_TITLE={$ARG_TITLE}"

        /** Opens the chat tab on one conversation, e.g. the thread scoped to a task. */
        fun destination(conversationId: String? = null, title: String? = null): String =
            conversationId?.let { "$route?$ARG_CONVERSATION_ID=${Uri.encode(it)}" +
                (title?.let { value -> "&$ARG_TITLE=${Uri.encode(value)}" } ?: "") } ?: route
    }
    data object Inbox : NavRoute("inbox")
    data object Progress : NavRoute("progress")
    data object Tasks : NavRoute("tasks") {
        const val ARG_TODO_ID = "todo_id"
        val routePattern = "$route?$ARG_TODO_ID={$ARG_TODO_ID}"

        fun destination(todoId: String? = null): String =
            todoId?.let { "$route?$ARG_TODO_ID=${Uri.encode(it)}" } ?: route
    }
    data object Review : NavRoute("review") {
        const val ARG_RUN_ID = "run_id"
        const val ARG_REVIEW_ID = "review_id"
        val routePattern = "$route?$ARG_REVIEW_ID={$ARG_REVIEW_ID}&$ARG_RUN_ID={$ARG_RUN_ID}"
        fun forRun(runId: String): String = "$route?$ARG_RUN_ID=${Uri.encode(runId)}"

        fun destination(reviewId: String? = null): String =
            reviewId?.let { "$route?$ARG_REVIEW_ID=${Uri.encode(it)}" } ?: route
    }
    data object Runs : NavRoute("runs") {
        const val ARG_RUN_ID = "run_id"
        val routePattern = "$route?$ARG_RUN_ID={$ARG_RUN_ID}"

        fun destination(runId: String? = null): String =
            runId?.let { "$route?$ARG_RUN_ID=${Uri.encode(it)}" } ?: route
    }
    data object Search : NavRoute("search")
    data object Projects : NavRoute("projects")
    data object Settings : NavRoute("settings")
}
