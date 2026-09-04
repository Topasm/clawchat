package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.common.WidgetState
import kotlinx.coroutines.CancellationException

internal data class TodoWidgetSnapshot(
    val state: WidgetState<TodoWidgetUiModel>,
    val workspaceKey: String?,
)

/**
 * Loads widget data against one workspace, then revalidates that identity
 * before Glance can publish the result. A late response from workspace A must
 * never be rendered with actions scoped to workspace B.
 */
internal suspend fun loadTodoWidgetSnapshot(
    horizonDays: Int,
    runtimeState: suspend () -> AppRuntimeState,
    loadDeadlines: suspend () -> ApiResult<PaginatedResponse<Todo>>,
    loadCachedTodos: suspend () -> List<Todo> = { emptyList() },
): TodoWidgetSnapshot {
    val initial = runtimeState()
    val initialWorkspaceKey = initial.workspaceKey?.takeIf(String::isNotBlank)
    if (initial.mode == WorkspaceMode.UNCONFIGURED || initialWorkspaceKey == null) {
        return TodoWidgetSnapshot(WidgetState.NotLoggedIn, initialWorkspaceKey)
    }

    val result = loadDeadlines()
    val state = if (result is ApiResult.Error) {
        val cached = try {
            loadCachedTodos()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            emptyList()
        }
        if (cached.isEmpty()) {
            WidgetState.Error(result.message)
        } else {
            // The cache holds whatever was last synced, not the horizon slice,
            // so the projection applies the same window to it.
            WidgetState.Success(TodoWidgetUiModel.from(cached, horizonDays))
        }
    } else {
        result.toWidgetState(horizonDays)
    }
    val current = runtimeState()
    val currentWorkspaceKey = current.workspaceKey?.takeIf(String::isNotBlank)
    if (current.mode != initial.mode || currentWorkspaceKey != initialWorkspaceKey) {
        val state = if (
            current.mode == WorkspaceMode.UNCONFIGURED || currentWorkspaceKey == null
        ) {
            WidgetState.NotLoggedIn
        } else {
            // The application session coordinator schedules another refresh for
            // the new workspace. Until then, fail closed instead of showing A's
            // titles with B's completion actions.
            WidgetState.Loading
        }
        return TodoWidgetSnapshot(state, currentWorkspaceKey)
    }

    return TodoWidgetSnapshot(state, initialWorkspaceKey)
}

private fun ApiResult<PaginatedResponse<Todo>>.toWidgetState(
    horizonDays: Int,
): WidgetState<TodoWidgetUiModel> = when (this) {
    is ApiResult.Success -> WidgetState.Success(TodoWidgetUiModel.from(data.items, horizonDays))
    is ApiResult.Error -> WidgetState.Error(message)
    is ApiResult.Loading -> WidgetState.Loading
}
