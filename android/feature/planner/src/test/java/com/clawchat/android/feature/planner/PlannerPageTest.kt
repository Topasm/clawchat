package com.clawchat.android.feature.planner

import org.junit.Assert.assertEquals
import org.junit.Test

class PlannerPageTest {

    @Test
    fun `planner moves from today through week to month`() {
        assertEquals(
            listOf(PlannerPage.TODAY, PlannerPage.WEEK, PlannerPage.MONTH),
            PLANNER_PAGE_ORDER,
        )
    }
}
