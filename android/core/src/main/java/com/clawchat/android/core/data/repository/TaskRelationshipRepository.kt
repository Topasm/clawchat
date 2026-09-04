package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/** Read-only mobile access to task graph context. Graph mutations remain server-coordinated. */
@Singleton
class TaskRelationshipRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
) {
    suspend fun listForTask(taskId: String): ApiResult<List<TaskRelationship>> {
        val runtimeState = sessionStore.runtimeState.first()
        return when (runtimeState.mode) {
            WorkspaceMode.LOCAL -> ApiResult.Success(emptyList())
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                apiCall { api.listTaskRelationships(taskId, expectedScope) }
            }
        }
    }
}
