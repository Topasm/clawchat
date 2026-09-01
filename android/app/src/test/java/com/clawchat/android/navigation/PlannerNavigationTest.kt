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
}
