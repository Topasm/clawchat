package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Routes that carry an id go through android.net.Uri.encode, which plain JVM
// tests cannot run; the home list only ever targets id-less routes.
class HomeRoutesTest {
    @Test
    fun `every home row opens in its own workspace and appears once`() {
        for (mode in WorkspaceMode.entries) {
            val routes = NavigationCapabilities.homeRoutes(mode)
            assertEquals(routes.size, routes.toSet().size)
            routes.forEach { assertTrue("$mode $it", NavigationCapabilities.canOpen(mode, it)) }
        }
    }

    @Test
    fun `settings is the last row of every home list`() {
        for (mode in listOf(WorkspaceMode.LOCAL, WorkspaceMode.SERVER)) {
            assertEquals(NavRoute.Settings.route, NavigationCapabilities.homeRoutes(mode).last())
        }
    }

    @Test
    fun `a server workspace starts its list with the inbox`() {
        assertEquals(NavRoute.Inbox.route, NavigationCapabilities.homeRoutes(WorkspaceMode.SERVER).first())
    }

    @Test
    fun `the local list keeps to what the device can do`() {
        assertEquals(
            listOf(NavRoute.Today.route, NavRoute.Calendar.route, NavRoute.Tasks.route, NavRoute.Settings.route),
            NavigationCapabilities.homeRoutes(WorkspaceMode.LOCAL),
        )
        assertFalse(NavRoute.Chat.route in NavigationCapabilities.homeRoutes(WorkspaceMode.LOCAL))
        assertTrue(NavigationCapabilities.homeRoutes(WorkspaceMode.UNCONFIGURED).isEmpty())
    }

    @Test
    fun `the server list reads inbox, today, schedule, tasks, progress, projects, chat, devices, settings`() {
        assertEquals(
            listOf("inbox", "today", "calendar", "tasks", "progress", "projects", "chat", "devices", "settings"),
            NavigationCapabilities.homeRoutes(WorkspaceMode.SERVER),
        )
    }

    @Test
    fun `home is the start destination once a workspace exists`() {
        assertEquals(NavRoute.Home.route, NavigationCapabilities.startRoute(WorkspaceMode.LOCAL))
        assertEquals(NavRoute.Home.route, NavigationCapabilities.startRoute(WorkspaceMode.SERVER))
        assertEquals(NavRoute.Onboarding.route, NavigationCapabilities.startRoute(WorkspaceMode.UNCONFIGURED))
    }
}
