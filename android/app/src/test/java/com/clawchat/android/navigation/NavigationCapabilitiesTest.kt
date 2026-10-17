package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationCapabilitiesTest {
    @Test
    fun `local mode rejects every server-only destination`() {
        listOf("inbox", "progress", "chat", "projects", "devices", "review", "runs", "runs?run_id=run-1").forEach { route ->
            assertFalse(route, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, route))
        }
        listOf("home", "today", "tasks", "calendar", "search", "settings", "onboarding").forEach { route ->
            assertTrue(route, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, route))
        }
    }

    @Test
    fun `server mode opens its list, its detail routes and search`() {
        listOf("home", "search", "progress", "projects", "inbox", "chat", "devices", "review").forEach { route ->
            assertTrue(route, NavigationCapabilities.canOpen(WorkspaceMode.SERVER, route))
        }
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "review?review_id=review-1"))
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "runs?run_id=run-1"))
        assertFalse(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "unknown"))
    }

    @Test
    fun `search is reachable from the home list but is not a row of it`() {
        for (mode in listOf(WorkspaceMode.LOCAL, WorkspaceMode.SERVER)) {
            assertTrue(NavigationCapabilities.canOpen(mode, NavRoute.Search.route))
            assertFalse(NavRoute.Search.route in NavigationCapabilities.homeRoutes(mode))
        }
    }

    @Test
    fun `unconfigured mode exposes onboarding only`() {
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.UNCONFIGURED, "onboarding"))
        assertFalse(NavigationCapabilities.canOpen(WorkspaceMode.UNCONFIGURED, "home"))
        assertFalse(NavigationCapabilities.canOpen(WorkspaceMode.UNCONFIGURED, "today"))
    }
}
