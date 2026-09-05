package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.ReadyRunRequest
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.flow.first
import javax.inject.Inject

class ProjectPlanRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessions: SessionStore,
) {
    private suspend fun <T> request(block: suspend (ExpectedSessionScope) -> T): ApiResult<T> {
        val state = sessions.runtimeState.first()
        if (state.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = state.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall { block(scope) }
    }
    suspend fun list() = request { api.listProjects(it) }
    suspend fun project(id: String) = request { api.getProject(id, it) }
    suspend fun graph(rootId: String) = request { api.getProjectGraph(rootId, it) }
    suspend fun run(taskId: String) = request {
        // Send both flags explicitly even when Retrofit's Json omits default values.
        api.runReadyTask(taskId, ReadyRunRequest(requireReady = true, approved = true), it)
    }
}
