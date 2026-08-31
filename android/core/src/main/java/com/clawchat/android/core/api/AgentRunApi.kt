package com.clawchat.android.core.api

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunResumeRequest
import com.clawchat.android.core.data.model.AgentRunRetryRequest
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/** Authenticated API used by the mobile run monitor and controls. */
interface AgentRunApi {
    @GET("api/runs")
    suspend fun listRuns(
        @Query("project_id") projectId: String? = null,
        @Query("status") status: String? = null,
        @Query("limit") limit: Int = 100,
    ): List<AgentRun>

    @GET("api/runs/{runId}")
    suspend fun getRun(@Path("runId") runId: String): AgentRun

    @GET("api/runs/{runId}/events")
    suspend fun listEvents(@Path("runId") runId: String): List<AgentRunEvent>

    @POST("api/runs/{runId}/cancel")
    suspend fun cancelRun(@Path("runId") runId: String): AgentRun

    @POST("api/runs/{runId}/retry")
    suspend fun retryRun(
        @Path("runId") runId: String,
        @Body request: AgentRunRetryRequest,
    ): AgentRun

    @POST("api/runs/{runId}/resume")
    suspend fun resumeRun(
        @Path("runId") runId: String,
        @Body request: AgentRunResumeRequest,
    ): AgentRun
}
