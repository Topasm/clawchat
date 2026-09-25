package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.AgentRunApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.CliSessionAction
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CliSessionRepository @Inject constructor(private val api: AgentRunApi, private val sessions: SessionStore) {
    private suspend fun <T> scoped(workspace: String, call: suspend (ExpectedSessionScope) -> T): ApiResult<T> {
        val runtime = sessions.runtimeState.first()
        runtime.workspaceMismatch(workspace)?.let { return it }
        if (runtime.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = runtime.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall { call(scope) }
    }

    suspend fun list(workspace: String) = scoped(workspace) { api.listCliSessions(it) }
    suspend fun detail(workspace: String, provider: String, id: String) =
        scoped(workspace) { api.getCliSession(provider, id, it) }
    suspend fun act(workspace: String, provider: String, id: String, action: CliSessionAction) =
        scoped(workspace) { api.controlCliSession(provider, id, action, it) }
}
