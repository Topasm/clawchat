package com.clawchat.android.navigation

import com.clawchat.android.feature.planner.PlannerPage
import org.junit.Assert.assertEquals
import org.junit.Test

class PlannerNavigationTest {

    @Test
    fun `today and week keep today selected while month selects calendar`() {
        assertEquals(
            NavRoute.Today.route,
            plannerDrawerRoute(NavRoute.Today.route, PlannerPage.TODAY),
        )
        assertEquals(
            NavRoute.Today.route,
            plannerDrawerRoute(NavRoute.Calendar.route, PlannerPage.WEEK),
        )
        assertEquals(
            NavRoute.Calendar.route,
            plannerDrawerRoute(NavRoute.Today.route, PlannerPage.MONTH),
        )
    }

    @Test
    fun `planner page does not change unrelated drawer destinations`() {
        assertEquals(
            NavRoute.Tasks.route,
            plannerDrawerRoute(NavRoute.Tasks.route, PlannerPage.MONTH),
        )
    }
}
