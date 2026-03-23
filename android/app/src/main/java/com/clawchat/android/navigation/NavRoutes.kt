package com.clawchat.android.navigation

/** Sealed hierarchy of all navigation destinations in the app. */
sealed class NavRoute(val route: String) {
    data object Onboarding : NavRoute("onboarding")
    data object Today : NavRoute("today")
    data object Chat : NavRoute("chat")
    data object Inbox : NavRoute("inbox")
    data object Tasks : NavRoute("tasks")
    data object Settings : NavRoute("settings")
}
