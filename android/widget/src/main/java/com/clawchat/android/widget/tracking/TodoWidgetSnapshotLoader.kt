package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.common.WidgetState

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
    runtimeState: suspend () -> AppRuntimeState,
    loadToday: suspend () -> ApiResult<TodayResponse>,
): TodoWidgetSnapshot {
    val initial = runtimeState()
    val initialWorkspaceKey = initial.workspaceKey?.takeIf(String::isNotBlank)
    if (initial.mode == WorkspaceMode.UNCONFIGURED || initialWorkspaceKey == null) {
        return TodoWidgetSnapshot(WidgetState.NotLoggedIn, initialWorkspaceKey)
    }

    val result = loadToday()
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

    return TodoWidgetSnapshot(result.toWidgetState(), initialWorkspaceKey)
}

private fun ApiResult<TodayResponse>.toWidgetState(): WidgetState<TodoWidgetUiModel> = when (this) {
    is ApiResult.Success -> WidgetState.Success(TodoWidgetUiModel.from(data))
    is ApiResult.Error -> WidgetState.Error(message)
    is ApiResult.Loading -> WidgetState.Loading
}
