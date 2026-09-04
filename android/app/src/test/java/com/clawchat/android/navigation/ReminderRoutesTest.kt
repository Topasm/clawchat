package com.clawchat.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReminderRoutesTest {

    @Test
    fun `task reminders open the tasks screen`() {
        assertEquals(NavRoute.Tasks.route, reminderRoute("todo"))
        assertEquals(NavRoute.Tasks.route, reminderRoute("todo_overdue"))
        assertEquals(NavRoute.Tasks.route, reminderRoute("nudge"))
    }

    @Test
    fun `attention digest opens now`() {
        assertEquals(NavRoute.Progress.route, reminderRoute("attention"))
    }

    @Test
    fun `event and review reminders open today`() {
        assertEquals(NavRoute.Today.route, reminderRoute("event"))
        assertEquals(NavRoute.Today.route, reminderRoute("weekly_review"))
    }

    @Test
    fun `an unknown or missing type leaves navigation alone`() {
        assertNull(reminderRoute(null))
        assertNull(reminderRoute(""))
        assertNull(reminderRoute("something_new"))
    }
}
