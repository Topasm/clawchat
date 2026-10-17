package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlannerNavigationTest {
    @Test
    fun `today and schedule are two rows that open the same planner`() {
        for (mode in listOf(WorkspaceMode.LOCAL, WorkspaceMode.SERVER)) {
            val rows = NavigationCapabilities.homeRoutes(mode)
            assertTrue(NavRoute.Today.route in rows)
            assertTrue(NavRoute.Calendar.route in rows)
            assertEquals(rows.indexOf(NavRoute.Today.route) + 1, rows.indexOf(NavRoute.Calendar.route))
        }
    }

    @Test
    fun `project detail pattern still maps to the projects screen`() {
        assertEquals(true, NavigationCapabilities.canOpen(WorkspaceMode.SERVER, "projects?project_id=p&task_id=t"))
        assertEquals(false, NavigationCapabilities.canOpen(WorkspaceMode.LOCAL, "projects?project_id=p&task_id=t"))
    }
}
