package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskCommentCreateRequest
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/** User-authored comment threads on a task, one thread per todo. */
@Singleton
class TaskCommentRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
) {
    suspend fun listForTodos(todoIds: List<String>): ApiResult<List<TaskComment>> {
        if (todoIds.isEmpty()) return ApiResult.Success(emptyList())
        val runtimeState = sessionStore.runtimeState.first()
        return when (runtimeState.mode) {
            WorkspaceMode.LOCAL -> ApiResult.Success(emptyList())
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                apiCall { api.listTaskComments(todoIds.joinToString(","), expectedScope) }
            }
        }
    }

    suspend fun addComment(todoId: String, content: String): ApiResult<TaskComment> {
        val runtimeState = sessionStore.runtimeState.first()
        return when (runtimeState.mode) {
            WorkspaceMode.LOCAL -> ApiResult.Error("Task comments require a server")
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                apiCall {
                    api.createTaskComment(TaskCommentCreateRequest(todoId, content), expectedScope)
                }
            }
        }
    }

    suspend fun deleteComment(commentId: String): ApiResult<Unit> {
        val runtimeState = sessionStore.runtimeState.first()
        return when (runtimeState.mode) {
            WorkspaceMode.LOCAL -> ApiResult.Error("Task comments require a server")
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                apiCall { api.deleteTaskComment(commentId, expectedScope) }
            }
        }
    }
}
