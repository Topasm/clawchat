package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationCapabilitiesTest {

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
        listOf("inbox", "chat", "review", "runs", "runs?run_id=run-1").forEach { route ->
            assertFalse(route, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, route))
        }
        listOf("today", "tasks", "calendar", "search", "settings", "onboarding").forEach { route ->
            assertTrue(route, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, route))
        }
    }

    @Test
    fun `server mode retains the connected primary navigation`() {
        assertEquals(
            listOf("inbox", "tasks", "today", "chat"),
            NavigationCapabilities.primaryRoutes(WorkspaceMode.SERVER),
        )
        assertEquals(
            listOf("review", "runs", "search", "settings"),
            NavigationCapabilities.secondaryRoutes(WorkspaceMode.SERVER),
        )
        assertTrue(NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "review"))
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
    fun `start destination follows workspace capture capability`() {
        assertEquals("onboarding", NavigationCapabilities.startRoute(WorkspaceMode.UNCONFIGURED))
        assertEquals("tasks", NavigationCapabilities.startRoute(WorkspaceMode.LOCAL))
        assertEquals("inbox", NavigationCapabilities.startRoute(WorkspaceMode.SERVER))
    }
}
