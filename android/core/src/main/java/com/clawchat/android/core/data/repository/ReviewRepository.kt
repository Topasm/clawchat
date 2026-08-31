package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ReviewApi
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewDecisionRequest
import com.clawchat.android.core.data.model.ReviewDecisionResponse
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

interface ReviewRepository {
    suspend fun listPending(projectId: String? = null): ApiResult<List<ReviewItem>>

    suspend fun decide(
        reviewId: String,
        decision: ReviewDecision,
        note: String? = null,
    ): ApiResult<ReviewDecisionResponse>
}

@Singleton
class ReviewRepositoryImpl @Inject constructor(
    private val api: ReviewApi,
) : ReviewRepository {
    override suspend fun listPending(projectId: String?): ApiResult<List<ReviewItem>> =
        apiCall { api.listReviews(status = "pending", projectId = projectId) }

    override suspend fun decide(
        reviewId: String,
        decision: ReviewDecision,
        note: String?,
    ): ApiResult<ReviewDecisionResponse> = apiCall {
        api.decideReview(
            reviewId = reviewId,
            body = ReviewDecisionRequest(decision = decision, note = note),
        )
    }
}
