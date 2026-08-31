package com.clawchat.android.core.api

import com.clawchat.android.core.data.model.ReviewDecisionRequest
import com.clawchat.android.core.data.model.ReviewDecisionResponse
import com.clawchat.android.core.data.model.ReviewItem
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/** Authenticated API for the unified Review Inbox. */
interface ReviewApi {
    @GET("api/reviews")
    suspend fun listReviews(
        @Query("status") status: String = "pending",
        @Query("project_id") projectId: String? = null,
    ): List<ReviewItem>

    @POST("api/reviews/{reviewId}/decision")
    suspend fun decideReview(
        @Path("reviewId") reviewId: String,
        @Body body: ReviewDecisionRequest,
    ): ReviewDecisionResponse
}
