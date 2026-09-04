package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ReviewApi
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.PendingReviewDecisionStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import java.io.IOException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.jsonPrimitive

class ReviewRepositoryTest {
    private val api = mockk<ReviewApi>()
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(
            AppRuntimeState(
                mode = WorkspaceMode.SERVER,
                activeSession = ActiveSession(
                    token = "token",
                    apiBaseUrl = "https://workspace.example",
                    hostId = null,
                    authMode = "manual",
                ),
                hasSavedServerSession = true,
                workspaceKey = WORKSPACE,
            ),
        )
    }
    private val pending = mockk<PendingReviewDecisionStore>(relaxed = true)
    private val repository = ReviewRepositoryImpl(api, sessionStore, pending)

    @Test
    fun `offline confirmed decision is queued and returned optimistically`() = runTest {
        val review = ReviewItem(
            id = "review-1",
            subjectType = ReviewSubjectType.AGENT_RUN,
            subjectId = "run-1",
            summary = "Review result",
            requestedAt = "2026-09-01T00:00:00Z",
        )
        coEvery { api.decideReview(any(), any(), any()) } throws IOException("offline")

        val result = repository.decide(review, ReviewDecision.APPROVED, "Looks good")

        assertTrue(result is ApiResult.Success)
        assertEquals(ReviewStatus.APPROVED, (result as ApiResult.Success).data.review.status)
        assertEquals("pending", result.data.outcome["sync_status"]?.jsonPrimitive?.content)
        coVerify(exactly = 1) {
            pending.enqueue(
                workspaceKey = WORKSPACE,
                reviewId = "review-1",
                subjectId = "run-1",
                decision = ReviewDecision.APPROVED,
                note = "Looks good",
                changedAt = any(),
            )
        }
    }

    private companion object {
        const val WORKSPACE = "server:url:test"
    }
}
