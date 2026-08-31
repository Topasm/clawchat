package com.clawchat.android.navigation

import android.net.Uri

/** Sealed hierarchy of all navigation destinations in the app. */
sealed class NavRoute(val route: String) {
    data object Onboarding : NavRoute("onboarding")
    data object Today : NavRoute("today")
    data object Calendar : NavRoute("calendar")
    data object Chat : NavRoute("chat")
    data object Inbox : NavRoute("inbox")
    data object Tasks : NavRoute("tasks")
    data object Review : NavRoute("review")
    data object Runs : NavRoute("runs") {
        const val ARG_RUN_ID = "run_id"
        val routePattern = "$route?$ARG_RUN_ID={$ARG_RUN_ID}"

        fun destination(runId: String? = null): String =
            runId?.let { "$route?$ARG_RUN_ID=${Uri.encode(it)}" } ?: route
    }
    data object Search : NavRoute("search")
    data object Settings : NavRoute("settings")
}
