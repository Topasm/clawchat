package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode

/**
 * One policy for every navigation surface. Keeping route availability out of
 * the composables prevents a local-only workspace from accidentally exposing a
 * server feature through the drawer, a search hit, or a deep link.
 */
internal object NavigationCapabilities {
    private val localPrimaryRoutes = listOf(
        NavRoute.Tasks.route,
        NavRoute.Today.route,
    )

    private val localSecondaryRoutes = listOf(
        NavRoute.Search.route,
        NavRoute.Settings.route,
    )

    private val serverPrimaryRoutes = listOf(
        NavRoute.Progress.route,
        NavRoute.Tasks.route,
        NavRoute.Today.route,
        NavRoute.Chat.route,
    )

    private val serverSecondaryRoutes = listOf(
        NavRoute.Search.route,
        NavRoute.Settings.route,
    )

    /** Detail routes opened from Now rows or existing deep links, not drawer destinations. */
    private val serverInternalRoutes = listOf(
        NavRoute.Inbox.route,
        NavRoute.Review.route,
        NavRoute.Runs.route,
    )

    private val plannerRoutes = setOf(NavRoute.Today.route, NavRoute.Calendar.route)

    private val localAllowedRoutes = (
        localPrimaryRoutes + localSecondaryRoutes + plannerRoutes + NavRoute.Onboarding.route
        ).toSet()

    private val serverAllowedRoutes = (
        serverPrimaryRoutes + serverSecondaryRoutes + serverInternalRoutes +
            plannerRoutes + NavRoute.Onboarding.route
        ).toSet()

    fun startRoute(mode: WorkspaceMode): String = when (mode) {
        WorkspaceMode.UNCONFIGURED -> NavRoute.Onboarding.route
        WorkspaceMode.LOCAL -> NavRoute.Tasks.route
        WorkspaceMode.SERVER -> NavRoute.Progress.route
    }

    fun primaryRoutes(mode: WorkspaceMode): List<String> = when (mode) {
        WorkspaceMode.UNCONFIGURED -> emptyList()
        WorkspaceMode.LOCAL -> localPrimaryRoutes
        WorkspaceMode.SERVER -> serverPrimaryRoutes
    }

    fun secondaryRoutes(mode: WorkspaceMode): List<String> = when (mode) {
        WorkspaceMode.UNCONFIGURED -> emptyList()
        WorkspaceMode.LOCAL -> localSecondaryRoutes
        WorkspaceMode.SERVER -> serverSecondaryRoutes
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
