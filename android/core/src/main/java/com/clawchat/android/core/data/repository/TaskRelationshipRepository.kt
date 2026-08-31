package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** Read-only mobile access to task graph context. Graph mutations remain server-coordinated. */
@Singleton
class TaskRelationshipRepository @Inject constructor(
    private val api: ClawChatApi,
) {
    suspend fun listForTask(taskId: String): ApiResult<List<TaskRelationship>> =
        apiCall { api.listTaskRelationships(taskId) }
}
