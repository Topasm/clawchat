package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskCommentCreateRequest
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/** User-authored comment threads on a task, one thread per todo. */
@Singleton
class TaskCommentRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
    private val pendingUpdates: PendingTodoUpdateStore,
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

    suspend fun addComment(
        todoId: String,
        content: String,
        idempotencyKey: String = UUID.randomUUID().toString(),
    ): ApiResult<TaskComment> {
        val runtimeState = sessionStore.runtimeState.first()
        return when (runtimeState.mode) {
            WorkspaceMode.LOCAL -> ApiResult.Error("Task comments require a server")
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.SERVER -> {
                val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
                    ?: return workspaceNotConfigured()
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                val changedAt = Instant.now().toString()
                val normalized = content.trim()
                if (normalized.isEmpty() || normalized.length > MAX_COMMENT_LENGTH) {
                    return ApiResult.Error("Comment must be between 1 and 4000 characters", code = 422)
                }
                val operationId = runCatching { UUID.fromString(idempotencyKey).toString() }
                    .getOrElse {
                        return ApiResult.Error("Invalid comment idempotency key", code = 422)
                    }
                pendingUpdates.enqueueComment(
                    workspaceKey = workspaceKey,
                    operationId = operationId,
                    todoId = todoId,
                    content = normalized,
                    changedAt = changedAt,
                )
                val result = apiCall {
                    api.createTaskComment(
                        TaskCommentCreateRequest(todoId, normalized, operationId),
                        expectedScope,
                    )
                }
                when (result) {
                    is ApiResult.Success -> {
                        pendingUpdates.remove(workspaceKey, listOf(operationId))
                        result
                    }
                    is ApiResult.Error -> if (result.isRetryable()) {
                        pendingUpdates.recordFailure(workspaceKey, todoId, result.message)
                        ApiResult.Success(
                            TaskComment(
                                id = operationId,
                                todoId = todoId,
                                content = normalized,
                                createdBy = "user",
                                createdAt = changedAt,
                                updatedAt = changedAt,
                            ),
                        )
                    } else {
                        pendingUpdates.remove(workspaceKey, listOf(operationId))
                        result
                    }
                    ApiResult.Loading -> ApiResult.Loading
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

private fun ApiResult.Error.isRetryable(): Boolean =
    code == null || code in setOf(408, 425, 429) || code >= 500

private const val MAX_COMMENT_LENGTH = 4_000
