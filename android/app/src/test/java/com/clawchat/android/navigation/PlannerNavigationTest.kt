package com.clawchat.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class PlannerNavigationTest {

    @Test
    fun `all planner pages select the single schedule primary destination`() {
        assertEquals(
            NavRoute.Today.route,
            plannerPrimaryRoute(NavRoute.Today.route),
        )
        assertEquals(
            NavRoute.Today.route,
            plannerPrimaryRoute(NavRoute.Calendar.route),
        )
        assertEquals(
            NavRoute.Today.route,
            plannerPrimaryRoute(NavRoute.Today.route),
        )
    }

    @Test
    fun `planner page does not change unrelated primary destinations`() {
        assertEquals(
            NavRoute.Tasks.route,
            plannerPrimaryRoute(NavRoute.Tasks.route),
        )
        assertEquals(
            NavRoute.Progress.route,
            plannerPrimaryRoute(NavRoute.Progress.route),
        )
    }

    // Regression: tapping the tab that is also the graph's start destination
    // (Progress in server mode) after visiting another tab silently did
    // nothing, because the normal saveState/restoreState popUpTo never
    // actually pops the start destination's own back-stack entry.
    @Test
    fun `a bare start destination is recognised regardless of query pattern`() {
        assertEquals(true, isStartDestinationTarget(NavRoute.Progress.route, NavRoute.Progress.route))
        assertEquals(false, isStartDestinationTarget(NavRoute.Tasks.route, NavRoute.Progress.route))
    }

    @Test
    fun `a start destination with an optional argument still matches its bare tab route`() {
        // Local mode's start destination registers as "tasks?todo_id={todo_id}",
        // but the bottom-nav tap always targets the bare "tasks" route.
        assertEquals(
            true,
            isStartDestinationTarget(NavRoute.Tasks.route, NavRoute.Tasks.routePattern),
        )
    }

    @Test
    fun `a null start destination route matches nothing`() {
        assertEquals(false, isStartDestinationTarget(NavRoute.Progress.route, null))
    }
}
