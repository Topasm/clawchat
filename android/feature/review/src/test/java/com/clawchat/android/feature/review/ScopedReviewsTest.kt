package com.clawchat.android.feature.review

import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewSubjectType
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

class ScopedReviewsTest {
    private val matching = ReviewItem(id = "review1", subjectId = "run1", subjectType = ReviewSubjectType.AGENT_RUN,
        summary = "Result", requestedAt = "2026-09-05T00:00:00Z")
    private val items = listOf(matching, matching.copy(id = "review2", subjectId = "run2"),
        matching.copy(id = "plan", subjectType = ReviewSubjectType.PLAN_PROPOSAL))

    @Test fun `run shortcut never exposes another run or matching plan id`() {
        assertEquals(listOf(matching), scopedReviews(items, null, "run1"))
        assertTrue(scopedReviews(items, null, "missing").isEmpty())
    }
    @Test fun `explicit review takes precedence and global inbox is unchanged`() {
        assertEquals(listOf(items[1]), scopedReviews(items, "review2", "run1"))
        assertEquals(items, scopedReviews(items, null, null))
    }
}
