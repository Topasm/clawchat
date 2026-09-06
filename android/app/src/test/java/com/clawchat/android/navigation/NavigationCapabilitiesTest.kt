package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationCapabilitiesTest {
    @Test fun `Inbox is the server home while attention remains reachable without becoming a primary tab`() {
        assertEquals(NavRoute.Inbox.route, NavigationCapabilities.drawerRoutes(WorkspaceMode.SERVER).first())
        assertTrue(NavRoute.Progress.route in NavigationCapabilities.secondaryRoutes(WorkspaceMode.SERVER))
        assertFalse(NavRoute.Progress.route in NavigationCapabilities.primaryRoutes(WorkspaceMode.SERVER))
    }

    @Test fun `settings stays available as a drawer detail destination in both workspaces`() {
        for (mode in listOf(WorkspaceMode.LOCAL, WorkspaceMode.SERVER)) {
            assertTrue(NavRoute.Settings.route in NavigationCapabilities.drawerRoutes(mode))
            assertTrue(NavRoute.Settings.route in NavigationCapabilities.secondaryRoutes(mode))
            assertFalse(NavRoute.Settings.route in NavigationCapabilities.primaryRoutes(mode))
        }
    }

    @Test fun `drawer destinations are unique and supported by their workspace`() {
        for (mode in WorkspaceMode.entries) {
            val routes = NavigationCapabilities.drawerRoutes(mode)
            assertEquals(routes.size, routes.toSet().size)
            routes.forEach { assertTrue(NavigationCapabilities.canOpen(mode, it)) }
        }
        assertEquals(emptyList<String>(), NavigationCapabilities.drawerRoutes(WorkspaceMode.UNCONFIGURED))
        assertTrue(NavRoute.Inbox.route in NavigationCapabilities.drawerRoutes(WorkspaceMode.SERVER))
        assertTrue(NavRoute.Projects.route in NavigationCapabilities.drawerRoutes(WorkspaceMode.SERVER))
        assertFalse(NavRoute.Chat.route in NavigationCapabilities.drawerRoutes(WorkspaceMode.LOCAL))
    }

    @Test
    fun `local mode exposes only device features`() {
        assertEquals(
            listOf("tasks", "today"),
            NavigationCapabilities.primaryRoutes(WorkspaceMode.LOCAL),
        )
        assertEquals(
            listOf("search", "settings"),
            NavigationCapabilities.secondaryRoutes(WorkspaceMode.LOCAL),
        )
    }

    @Test
    fun `local mode rejects every server-only destination`() {
        listOf("inbox", "progress", "chat", "projects", "review", "runs", "runs?run_id=run-1").forEach { route ->
            assertFalse(route, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, route))
        }
        listOf("today", "tasks", "calendar", "search", "settings", "onboarding").forEach { route ->
            assertTrue(route, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, route))
        }
    }

    @Test
    fun `server mode starts with capture and keeps attention as a secondary destination`() {
        assertEquals(
            listOf("inbox", "projects", "tasks", "today", "chat"),
            NavigationCapabilities.primaryRoutes(WorkspaceMode.SERVER),
        )
        assertEquals(
            listOf("progress", "search", "settings"),
            NavigationCapabilities.secondaryRoutes(WorkspaceMode.SERVER),
        )
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "progress"))
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "projects"))
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "inbox"))
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "review"))
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "review?review_id=review-1"))
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "runs?run_id=run-1"))
        assertFalse(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "unknown"))
    }

    @Test
    fun `unconfigured mode exposes onboarding only`() {
        assertTrue(NavigationCapabilities.primaryRoutes(WorkspaceMode.UNCONFIGURED).isEmpty())
        assertTrue(NavigationCapabilities.secondaryRoutes(WorkspaceMode.UNCONFIGURED).isEmpty())
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.UNCONFIGURED, "onboarding"))
        assertFalse(NavigationCapabilities.canOpen(WorkspaceMode.UNCONFIGURED, "today"))
    }

    @Test
    fun `start destination follows workspace mode`() {
        assertEquals("onboarding", NavigationCapabilities.startRoute(WorkspaceMode.UNCONFIGURED))
        assertEquals("tasks", NavigationCapabilities.startRoute(WorkspaceMode.LOCAL))
        assertEquals("inbox", NavigationCapabilities.startRoute(WorkspaceMode.SERVER))
    }
}
