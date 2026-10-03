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
    fun `a task reminder with an id opens that task`() {
        assertEquals(NavRoute.Tasks.destination("todo_1"), reminderRoute("todo", "todo_1"))
        assertEquals(NavRoute.Tasks.route, reminderRoute("todo", ""))
    }

    @Test
    fun `a run push opens that run`() {
        assertEquals(NavRoute.Runs.destination("run_1"), reminderRoute("run", "run_1"))
        assertEquals(NavRoute.Runs.route, reminderRoute("run"))
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
