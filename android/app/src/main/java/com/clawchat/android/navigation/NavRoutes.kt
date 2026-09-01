package com.clawchat.android.navigation

import android.net.Uri

/** Sealed hierarchy of all navigation destinations in the app. */
sealed class NavRoute(val route: String) {
    data object Onboarding : NavRoute("onboarding")
    data object Today : NavRoute("today")
    data object Calendar : NavRoute("calendar")
    data object Chat : NavRoute("chat")
    data object Inbox : NavRoute("inbox")
    data object Progress : NavRoute("progress")
    data object Tasks : NavRoute("tasks") {
        const val ARG_TODO_ID = "todo_id"
        val routePattern = "$route?$ARG_TODO_ID={$ARG_TODO_ID}"

        fun destination(todoId: String? = null): String =
            todoId?.let { "$route?$ARG_TODO_ID=${Uri.encode(it)}" } ?: route
    }
    data object Review : NavRoute("review") {
        const val ARG_REVIEW_ID = "review_id"
        val routePattern = "$route?$ARG_REVIEW_ID={$ARG_REVIEW_ID}"

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
    data object Settings : NavRoute("settings")
}
