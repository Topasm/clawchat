package com.clawchat.android.navigation

/** Sealed hierarchy of all navigation destinations in the app. */
sealed class NavRoute(val route: String) {
    data object Onboarding : NavRoute("onboarding")
    data object Today : NavRoute("today")
    data object Chat : NavRoute("chat")
    data object ChatDetail : NavRoute("chat/{conversationId}") {
        fun create(conversationId: String) = "chat/$conversationId"
    }
    data object Inbox : NavRoute("inbox")
    data object Tasks : NavRoute("tasks")
    data object TaskDetail : NavRoute("tasks/{taskId}") {
        fun create(taskId: String) = "tasks/$taskId"
    }
    data object Settings : NavRoute("settings")
    data object DeviceManagement : NavRoute("settings/devices")
}
