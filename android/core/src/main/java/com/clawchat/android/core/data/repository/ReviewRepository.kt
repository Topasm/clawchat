package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ReviewApi
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewDecisionRequest
import com.clawchat.android.core.data.model.ReviewDecisionResponse
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import com.clawchat.android.core.sync.PendingReviewDecisionStore
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

interface ReviewRepository {
    suspend fun listPending(projectId: String? = null): ApiResult<List<ReviewItem>>

    suspend fun decide(
        review: ReviewItem,
        decision: ReviewDecision,
        note: String? = null,
    ): ApiResult<ReviewDecisionResponse>

    suspend fun decideById(
        reviewId: String,
        decision: ReviewDecision,
        note: String? = null,
    ): ApiResult<ReviewDecisionResponse>
}

@Singleton
class ReviewRepositoryImpl @Inject constructor(
    private val api: ReviewApi,
    private val sessionStore: SessionStore,
    private val pendingDecisions: PendingReviewDecisionStore,
) : ReviewRepository {
    override suspend fun listPending(projectId: String?): ApiResult<List<ReviewItem>> {
        val state = sessionStore.runtimeState.first()
        if (state.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = state.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall { api.listReviews(status = "pending", projectId = projectId, scope) }
    }

    override suspend fun decide(
        review: ReviewItem,
        decision: ReviewDecision,
        note: String?,
    ): ApiResult<ReviewDecisionResponse> {
        val state = sessionStore.runtimeState.first()
        if (state.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val workspaceKey = state.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val scope = state.activeServerRequestScope() ?: return workspaceNotConfigured()
        val result = apiCall {
            api.decideReview(
                reviewId = review.id,
                body = ReviewDecisionRequest(decision = decision, note = note),
                expectedScope = scope,
            )
        }
        if (result is ApiResult.Error && result.isRetryableReviewFailure()) {
            pendingDecisions.enqueue(
                workspaceKey = workspaceKey,
                reviewId = review.id,
                subjectId = review.subjectId,
                decision = decision,
                note = note,
            )
            return ApiResult.Success(
                ReviewDecisionResponse(
                    review = review.copy(
                        status = decision.reviewStatus,
                        reviewedAt = Instant.now().toString(),
                        reviewNote = note,
                    ),
                    outcome = buildJsonObject { put("sync_status", "pending") },
                ),
            )
        }
        return result
    }

    override suspend fun decideById(
        reviewId: String,
        decision: ReviewDecision,
        note: String?,
    ): ApiResult<ReviewDecisionResponse> {
        val state = sessionStore.runtimeState.first()
        if (state.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = state.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall {
            api.decideReview(
                reviewId = reviewId,
                body = ReviewDecisionRequest(decision = decision, note = note),
                expectedScope = scope,
            )
        }
    }
}

private fun ApiResult.Error.isRetryableReviewFailure(): Boolean =
    code == null || code in setOf(408, 425, 429) || code >= 500

private val ReviewDecision.reviewStatus: ReviewStatus
    get() = when (this) {
        ReviewDecision.APPROVED -> ReviewStatus.APPROVED
        ReviewDecision.CHANGES_REQUESTED -> ReviewStatus.CHANGES_REQUESTED
        ReviewDecision.REJECTED -> ReviewStatus.REJECTED
    }
