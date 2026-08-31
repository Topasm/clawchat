package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.AgentRunApi
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunResumeRequest
import com.clawchat.android.core.data.model.AgentRunRetryRequest
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** Network-backed controls for inspecting and intervening in agent execution. */
@Singleton
class AgentRunRepository @Inject constructor(
    private val api: AgentRunApi,
) {
    suspend fun listRuns(
        projectId: String? = null,
        status: AgentRunStatus? = null,
        limit: Int = 100,
    ): ApiResult<List<AgentRun>> = apiCall {
        api.listRuns(projectId = projectId, status = status?.wireValue, limit = limit)
    }

    suspend fun getRun(runId: String): ApiResult<AgentRun> = apiCall {
        api.getRun(runId)
    }

    suspend fun listEvents(runId: String): ApiResult<List<AgentRunEvent>> = apiCall {
        api.listEvents(runId)
    }

    suspend fun cancelRun(runId: String): ApiResult<AgentRun> = apiCall {
        api.cancelRun(runId)
    }

    suspend fun retryRun(
        runId: String,
        followUpInstruction: String? = null,
    ): ApiResult<AgentRun> = apiCall {
        val normalized = followUpInstruction.normalizedFollowUp()
        api.retryRun(
            runId,
            AgentRunRetryRequest(
                followUpInstruction = normalized,
            ),
        )
    }

    suspend fun resumeRun(
        runId: String,
        followUpInstruction: String,
    ): ApiResult<AgentRun> = apiCall {
        val normalized = requireNotNull(followUpInstruction.normalizedFollowUp()) {
            "Follow-up instructions are required"
        }
        api.resumeRun(
            runId,
            AgentRunResumeRequest(followUpInstruction = normalized),
        )
    }

    private fun String?.normalizedFollowUp(): String? =
        this?.trim()?.takeIf(String::isNotEmpty)?.also {
            require(it.length <= MAX_FOLLOW_UP_LENGTH) {
                "Follow-up instructions cannot exceed $MAX_FOLLOW_UP_LENGTH characters"
            }
        }

    private companion object {
        const val MAX_FOLLOW_UP_LENGTH = 10_000
    }
}
