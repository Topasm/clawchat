package com.clawchat.android.core.sync

import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.WorkspaceStorageContext
import com.clawchat.android.core.data.workspaceDisplayName
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Live answer to "where are my items stored?": the workspace mode, the name of
 * the connected workspace, and which todos still wait in this device's outbox.
 * Screens turn it into a per-item location with `todoStorageLocation`.
 */
@Singleton
class ItemStorageLocator @Inject constructor(
    private val sessionStore: SessionStore,
    private val pendingTodos: PendingTodoUpdateStore,
) {
    @OptIn(ExperimentalCoroutinesApi::class)
    val storageContext: Flow<WorkspaceStorageContext> =
        combine(sessionStore.runtimeState, sessionStore.hostName) { state, hostName ->
            Triple(
                state.mode,
                state.workspaceKey,
                if (state.mode == WorkspaceMode.SERVER) {
                    workspaceDisplayName(hostName, state.activeSession?.apiBaseUrl)
                } else {
                    null
                },
            )
        }
            .distinctUntilChanged()
            .flatMapLatest { (mode, workspaceKey, workspaceName) ->
                val key = workspaceKey?.takeIf(String::isNotBlank)
                if (mode == WorkspaceMode.SERVER && key != null) {
                    pendingTodos.observePendingTodoIds(key).map { pendingIds ->
                        WorkspaceStorageContext(mode, workspaceName, pendingIds)
                    }
                } else {
                    flowOf(WorkspaceStorageContext(mode, workspaceName))
                }
            }
            .distinctUntilChanged()
}
