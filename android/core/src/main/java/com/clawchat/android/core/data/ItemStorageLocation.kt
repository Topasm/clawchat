package com.clawchat.android.core.data

import com.clawchat.android.core.data.model.Todo
import java.net.URI

/**
 * Where one item is held right now, as the user should understand it: only on
 * this device, on this device waiting to reach a workspace, or saved to a
 * workspace. [workspaceName] is null when the app knows no name for it; the UI
 * then says "your workspace".
 */
sealed interface ItemStorageLocation {
    /** Local mode: the item lives only in this device's database. */
    data object ThisDevice : ItemStorageLocation

    /** A create or edit is still queued on this device for [workspaceName]. */
    data class PendingSync(val workspaceName: String?) : ItemStorageLocation

    /** The item is saved to [workspaceName]. */
    data class Workspace(val workspaceName: String?) : ItemStorageLocation
}

/**
 * One snapshot of what decides an item's storage location: the workspace mode,
 * the connected workspace's display name, and which todo ids still have a
 * queued create or edit.
 */
data class WorkspaceStorageContext(
    val mode: WorkspaceMode,
    val workspaceName: String? = null,
    val pendingTodoIds: Set<String> = emptySet(),
)

/**
 * Derive an item's storage location. Returns null when no workspace has been
 * chosen yet, since nothing is stored anywhere meaningful then.
 */
fun itemStorageLocation(
    mode: WorkspaceMode,
    workspaceName: String?,
    hasPendingMutation: Boolean,
): ItemStorageLocation? {
    val name = workspaceName?.trim()?.takeIf(String::isNotEmpty)
    return when (mode) {
        WorkspaceMode.UNCONFIGURED -> null
        WorkspaceMode.LOCAL -> ItemStorageLocation.ThisDevice
        WorkspaceMode.SERVER -> if (hasPendingMutation) {
            ItemStorageLocation.PendingSync(name)
        } else {
            ItemStorageLocation.Workspace(name)
        }
    }
}

/**
 * Storage location of [todo] under [context]. A todo read from the local-mode
 * database is always on this device, even if the context has not loaded yet.
 * In server mode the live outbox decides, not the todo's own `syncStatus`,
 * which can be stale once the queue drains.
 */
fun todoStorageLocation(todo: Todo, context: WorkspaceStorageContext?): ItemStorageLocation? {
    if (todo.syncStatus == LOCAL_SYNC_STATUS) return ItemStorageLocation.ThisDevice
    context ?: return null
    return itemStorageLocation(
        mode = context.mode,
        workspaceName = context.workspaceName,
        hasPendingMutation = todo.id in context.pendingTodoIds,
    )
}

/** Whether a list row should carry a storage marker: synced items stay unmarked. */
fun ItemStorageLocation?.needsListMarker(): Boolean =
    this is ItemStorageLocation.ThisDevice || this is ItemStorageLocation.PendingSync

/**
 * The name to show for the connected workspace: the paired host's name when
 * known, else the server's host from its URL, else null.
 */
fun workspaceDisplayName(hostName: String?, apiBaseUrl: String?): String? {
    hostName?.trim()?.takeIf(String::isNotEmpty)?.let { return it }
    val url = apiBaseUrl?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val host = runCatching { URI(url).host }.getOrNull()
        ?: runCatching { URI("http://$url").host }.getOrNull()
    return host?.trim()?.takeIf(String::isNotEmpty)
}

private const val LOCAL_SYNC_STATUS = "local"
