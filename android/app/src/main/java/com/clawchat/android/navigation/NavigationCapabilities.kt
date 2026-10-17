package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode

/**
 * One policy for every navigation surface. Keeping route availability out of
 * the composables prevents a local-only workspace from accidentally exposing a
 * server feature through the home list, a search hit, or a deep link.
 */
internal object NavigationCapabilities {
    /**
     * The rows of the home list, top to bottom: where work comes in, the
     * day and the calendar, the tasks, then what is being followed and set up.
     * Settings is always last.
     */
    fun homeRoutes(mode: WorkspaceMode): List<String> = when (mode) {
        WorkspaceMode.SERVER -> listOf(
            NavRoute.Inbox.route,
            NavRoute.Today.route,
            NavRoute.Calendar.route,
            NavRoute.Tasks.route,
            NavRoute.Progress.route,
            NavRoute.Projects.route,
            NavRoute.Chat.route,
            NavRoute.Devices.route,
            NavRoute.Settings.route,
        )
        WorkspaceMode.LOCAL -> listOf(
            NavRoute.Today.route,
            NavRoute.Calendar.route,
            NavRoute.Tasks.route,
            NavRoute.Settings.route,
        )
        WorkspaceMode.UNCONFIGURED -> emptyList()
    }

    /** Reached from every workspace that has a home list. */
    private val commonRoutes = listOf(
        NavRoute.Home.route,
        NavRoute.Search.route,
        NavRoute.Onboarding.route,
    )

    /** Detail routes opened from attention rows or existing deep links. */
    private val serverInternalRoutes = listOf(
        NavRoute.Review.route,
        NavRoute.Runs.route,
    )

    private val localAllowedRoutes = (homeRoutes(WorkspaceMode.LOCAL) + commonRoutes).toSet()

    private val serverAllowedRoutes =
        (homeRoutes(WorkspaceMode.SERVER) + serverInternalRoutes + commonRoutes).toSet()

    fun startRoute(mode: WorkspaceMode): String = when (mode) {
        WorkspaceMode.UNCONFIGURED -> NavRoute.Onboarding.route
        WorkspaceMode.LOCAL, WorkspaceMode.SERVER -> NavRoute.Home.route
    }

    fun canOpen(mode: WorkspaceMode, route: String): Boolean {
        val baseRoute = route.substringBefore('?')
        return when (mode) {
            WorkspaceMode.UNCONFIGURED -> baseRoute == NavRoute.Onboarding.route
            WorkspaceMode.LOCAL -> baseRoute in localAllowedRoutes
            WorkspaceMode.SERVER -> baseRoute in serverAllowedRoutes
        }
    }
}
