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

    // Routes that carry an id go through android.net.Uri.encode, which plain JVM
    // tests cannot run; the id-less fallbacks are what can be checked here.
    @Test
    fun `a task reminder without an id opens the task list`() {
        assertEquals(NavRoute.Tasks.route, reminderRoute("todo", ""))
        assertEquals(NavRoute.Tasks.route, reminderRoute("todo_overdue", null))
    }

    @Test
    fun `a run push without an id opens the runs list`() {
        assertEquals(NavRoute.Runs.route, reminderRoute("run"))
        assertEquals(NavRoute.Runs.route, reminderRoute("run", " "))
    }

    @Test
    fun `a server reminder digest opens today`() {
        assertEquals(NavRoute.Today.route, reminderRoute("reminder", "push"))
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
