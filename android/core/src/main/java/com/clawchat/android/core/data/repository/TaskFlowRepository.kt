package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.data.model.TaskStepCreate
import com.clawchat.android.core.data.model.TaskStepResponse
import com.clawchat.android.core.data.model.TodoPath
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * A task's flow as the server keeps it: steps whose order is `depends_on`
 * edges, and the paths attached to the task. Only a server workspace has a
 * flow; a device-only workspace keeps plain sub-tasks.
 */
@Singleton
class TaskFlowRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
) {
    suspend fun isServer(): Boolean = sessionStore.runtimeState.first().mode == WorkspaceMode.SERVER

    /** Adds a step after the flow's end, wiring its order on the server in one change. */
    suspend fun addStep(parentId: String, title: String): ApiResult<TaskStepResponse> =
        server { scope -> api.addTaskStep(parentId, TaskStepCreate(title = title), scope) }

    suspend fun dependencies(): ApiResult<List<TaskRelationship>> =
        server(empty = emptyList()) { scope -> api.listTaskRelationshipsOfType("depends_on", 10_000, scope) }

    suspend fun paths(todoId: String): ApiResult<List<TodoPath>> =
        server(empty = emptyList()) { scope -> api.listTodoPaths(todoId, scope) }

    private suspend fun <T> server(
        empty: T? = null,
        call: suspend (ExpectedSessionScope) -> T,
    ): ApiResult<T> {
        val runtimeState = sessionStore.runtimeState.first()
        return when (runtimeState.mode) {
            WorkspaceMode.LOCAL -> empty?.let { ApiResult.Success(it) }
                ?: ApiResult.Error("Steps need a server workspace", code = 422)
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.SERVER -> {
                val scope = runtimeState.activeServerRequestScope() ?: return workspaceNotConfigured()
                apiCall { call(scope) }
            }
        }
    }
}
