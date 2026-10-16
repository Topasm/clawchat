package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.Note
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.common.WidgetState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** Filter on the server before pagination so closed work cannot crowd out open tasks. */
internal suspend fun loadOpenWidgetTodos(
    query: Map<String, String>,
    load: suspend (Map<String, String>) -> ApiResult<PaginatedResponse<Todo>>,
): ApiResult<PaginatedResponse<Todo>> = coroutineScope {
    val pending = async { load(query + ("status" to "pending")) }
    val running = async { load(query + ("status" to "in_progress")) }
    val results = listOf(pending.await(), running.await())
    val failure = results.filterIsInstance<ApiResult.Error>().firstOrNull()
    when {
        failure != null -> failure // Let the snapshot loader fall back to the complete cache.
        results.any { it is ApiResult.Loading } -> ApiResult.Loading
        else -> {
            val pages = results.filterIsInstance<ApiResult.Success<PaginatedResponse<Todo>>>()
            val items = pages.flatMap { it.data.items }.distinctBy { it.id }
                .filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
            ApiResult.Success(PaginatedResponse(items = items, total = pages.sumOf { it.data.total }))
        }
    }
}

internal data class WidgetSnapshot<out T>(
    val state: WidgetState<T>,
    val workspaceKey: String?,
)

internal typealias TodoWidgetSnapshot = WidgetSnapshot<TodoWidgetUiModel>

internal typealias NoteWidgetSnapshot = WidgetSnapshot<NoteWidgetUiModel>

/**
 * Loads widget data against one workspace, then revalidates that identity
 * before Glance can publish the result. A late response from workspace A must
 * never be rendered with actions scoped to workspace B.
 */
internal suspend fun loadTodoWidgetSnapshot(
    horizonDays: Int,
    runtimeState: suspend () -> AppRuntimeState,
    loadOpenTodos: suspend () -> ApiResult<PaginatedResponse<Todo>>,
    loadCachedTodos: suspend () -> List<Todo> = { emptyList() },
): TodoWidgetSnapshot = loadInWorkspace(runtimeState) {
    val result = loadOpenTodos()
    if (result is ApiResult.Error) {
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
            // The cache holds whatever was last synced; the projection applies
            // the same filters and window to it as to a fresh response.
            WidgetState.Success(TodoWidgetUiModel.from(cached, horizonDays))
        }
    } else {
        result.toWidgetState { TodoWidgetUiModel.from(it.items, horizonDays) }
    }
}

/** The notes tab: the most recently edited notes, under the same workspace guard. */
internal suspend fun loadNoteWidgetSnapshot(
    runtimeState: suspend () -> AppRuntimeState,
    loadNotes: suspend (workspaceKey: String) -> ApiResult<List<Note>>,
): NoteWidgetSnapshot = loadInWorkspace(runtimeState) { workspaceKey ->
    loadNotes(workspaceKey).toWidgetState { NoteWidgetUiModel.from(it) }
}

private suspend fun <T> loadInWorkspace(
    runtimeState: suspend () -> AppRuntimeState,
    load: suspend (workspaceKey: String) -> WidgetState<T>,
): WidgetSnapshot<T> {
    val initial = runtimeState()
    val initialWorkspaceKey = initial.workspaceKey?.takeIf(String::isNotBlank)
    if (initial.mode == WorkspaceMode.UNCONFIGURED || initialWorkspaceKey == null) {
        return WidgetSnapshot(WidgetState.NotLoggedIn, initialWorkspaceKey)
    }

    val state = load(initialWorkspaceKey)
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
        return WidgetSnapshot(state, currentWorkspaceKey)
    }

    return WidgetSnapshot(state, initialWorkspaceKey)
}

private fun <R, T> ApiResult<R>.toWidgetState(project: (R) -> T): WidgetState<T> = when (this) {
    is ApiResult.Success -> WidgetState.Success(project(data))
    is ApiResult.Error -> WidgetState.Error(message)
    is ApiResult.Loading -> WidgetState.Loading
}
