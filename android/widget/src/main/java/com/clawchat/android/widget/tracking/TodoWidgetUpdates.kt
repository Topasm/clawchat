package com.clawchat.android.widget.tracking

import androidx.datastore.preferences.core.stringPreferencesKey
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.widget.common.WidgetState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*

internal val WidgetRefreshKey = stringPreferencesKey("task_refresh_token")
internal val WidgetCompletionErrorWorkspaceKey = stringPreferencesKey("completion_error_workspace")

/** Reload inside the active composition; update() alone does not rerun provideGlance. */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun observeTodoWidgetSnapshots(
    runtime: Flow<AppRuntimeState>,
    changes: Flow<Unit> = emptyFlow(),
    load: suspend () -> TodoWidgetSnapshot,
): Flow<TodoWidgetSnapshot> = runtime
    .map { it.mode to it.workspaceKey }
    .distinctUntilChanged()
    .flatMapLatest { (mode, workspaceKey) ->
        if (mode == WorkspaceMode.UNCONFIGURED || workspaceKey.isNullOrBlank()) {
            flowOf(TodoWidgetSnapshot(WidgetState.NotLoggedIn, workspaceKey))
        } else changes.onStart { emit(Unit) }.transformLatest {
            emit(TodoWidgetSnapshot(WidgetState.Loading, workspaceKey))
            val snapshot = try {
                load()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                TodoWidgetSnapshot(WidgetState.Error("Unable to load tasks"), workspaceKey)
            }
            // Also guard a loader that ignores cancellation during a workspace switch.
            if (snapshot.workspaceKey == workspaceKey) emit(snapshot)
        }
    }
