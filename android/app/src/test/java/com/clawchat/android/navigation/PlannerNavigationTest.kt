package com.clawchat.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class PlannerNavigationTest {

    @Test
    fun `all planner pages select the single schedule drawer destination`() {
        assertEquals(
            NavRoute.Today.route,
            plannerDrawerRoute(NavRoute.Today.route),
        )
        assertEquals(
            NavRoute.Today.route,
            plannerDrawerRoute(NavRoute.Calendar.route),
        )
        assertEquals(
            NavRoute.Today.route,
            plannerDrawerRoute(NavRoute.Today.route),
        )
    }

    @Test
    fun `planner page does not change unrelated drawer destinations`() {
        assertEquals(
            NavRoute.Tasks.route,
            plannerDrawerRoute(NavRoute.Tasks.route),
        )
    }
}
