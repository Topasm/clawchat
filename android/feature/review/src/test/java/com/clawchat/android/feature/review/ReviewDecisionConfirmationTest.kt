package com.clawchat.android.feature.review

import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewRiskLevel
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewDecisionConfirmationTest {
    @Test
    fun `reject always requires confirmation`() {
        assertTrue(
            requiresReviewConfirmation(ReviewRiskLevel.LOW, ReviewDecision.REJECTED),
        )
        assertTrue(
            requiresReviewConfirmation(ReviewRiskLevel.MEDIUM, ReviewDecision.REJECTED),
        )
    }

    @Test
    fun `every high risk decision requires confirmation`() {
        ReviewDecision.entries.forEach { decision ->
            assertTrue(requiresReviewConfirmation(ReviewRiskLevel.HIGH, decision))
        }
    }

    @Test
    fun `non destructive non high risk decision stays direct`() {
        assertFalse(
            requiresReviewConfirmation(ReviewRiskLevel.MEDIUM, ReviewDecision.APPROVED),
        )
        assertFalse(
            requiresReviewConfirmation(
                ReviewRiskLevel.LOW,
                ReviewDecision.CHANGES_REQUESTED,
            ),
        )
    }
}
