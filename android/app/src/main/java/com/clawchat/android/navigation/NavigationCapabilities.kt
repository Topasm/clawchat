package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode

/**
 * One policy for every navigation surface. Keeping route availability out of
 * the composables prevents a local-only workspace from accidentally exposing a
 * server feature through the drawer, a search hit, or a deep link.
 */
internal object NavigationCapabilities {
    private val localPrimaryRoutes = listOf(
        NavRoute.Today.route,
        NavRoute.Tasks.route,
        NavRoute.Calendar.route,
    )

    private val localSecondaryRoutes = listOf(
        NavRoute.Search.route,
        NavRoute.Settings.route,
    )

    private val serverPrimaryRoutes = listOf(
        NavRoute.Today.route,
        NavRoute.Inbox.route,
        NavRoute.Tasks.route,
        NavRoute.Chat.route,
        NavRoute.Calendar.route,
    )

    private val serverSecondaryRoutes = listOf(
        NavRoute.Review.route,
        NavRoute.Runs.route,
        NavRoute.Search.route,
        NavRoute.Settings.route,
    )

    private val localAllowedRoutes = (
        localPrimaryRoutes + localSecondaryRoutes + NavRoute.Onboarding.route
        ).toSet()

    private val serverAllowedRoutes = (
        serverPrimaryRoutes + serverSecondaryRoutes + NavRoute.Onboarding.route
        ).toSet()

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
