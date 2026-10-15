package com.clawchat.android.core.data

import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ItemStorageLocationTest {

    @Test
    fun `local mode keeps every item on this device`() {
        assertEquals(
            ItemStorageLocation.ThisDevice,
            itemStorageLocation(WorkspaceMode.LOCAL, workspaceName = "Home", hasPendingMutation = false),
        )
        assertEquals(
            ItemStorageLocation.ThisDevice,
            itemStorageLocation(WorkspaceMode.LOCAL, workspaceName = null, hasPendingMutation = true),
        )
    }

    @Test
    fun `server mode names the workspace and flags queued edits`() {
        assertEquals(
            ItemStorageLocation.Workspace("Home"),
            itemStorageLocation(WorkspaceMode.SERVER, workspaceName = "Home", hasPendingMutation = false),
        )
        assertEquals(
            ItemStorageLocation.PendingSync("Home"),
            itemStorageLocation(WorkspaceMode.SERVER, workspaceName = " Home ", hasPendingMutation = true),
        )
    }

    @Test
    fun `blank workspace name becomes unnamed`() {
        assertEquals(
            ItemStorageLocation.Workspace(null),
            itemStorageLocation(WorkspaceMode.SERVER, workspaceName = "  ", hasPendingMutation = false),
        )
    }

    @Test
    fun `no workspace chosen has no location`() {
        assertNull(itemStorageLocation(WorkspaceMode.UNCONFIGURED, workspaceName = "Home", hasPendingMutation = true))
    }

    @Test
    fun `todo location follows the live outbox rather than its own sync status`() {
        val context = WorkspaceStorageContext(
            mode = WorkspaceMode.SERVER,
            workspaceName = "Studio Mac",
            pendingTodoIds = setOf("queued"),
        )

        assertEquals(
            ItemStorageLocation.PendingSync("Studio Mac"),
            todoStorageLocation(Todo(id = "queued", title = "Queued"), context),
        )
        // A stale "pending" stamp from before the queue drained is not trusted.
        assertEquals(
            ItemStorageLocation.Workspace("Studio Mac"),
            todoStorageLocation(Todo(id = "done", title = "Synced", syncStatus = "pending"), context),
        )
    }

    @Test
    fun `local todo is on this device even before the context loads`() {
        val localTodo = Todo(id = "l1", title = "Local", syncStatus = "local")

        assertEquals(ItemStorageLocation.ThisDevice, todoStorageLocation(localTodo, null))
        assertNull(todoStorageLocation(Todo(id = "s1", title = "Server"), null))
    }

    @Test
    fun `only device-only and pending items get a list marker`() {
        assertTrue(ItemStorageLocation.ThisDevice.needsListMarker())
        assertTrue(ItemStorageLocation.PendingSync("Home").needsListMarker())
        assertFalse(ItemStorageLocation.Workspace("Home").needsListMarker())
        assertFalse((null as ItemStorageLocation?).needsListMarker())
    }

    @Test
    fun `workspace display name prefers the paired host name then the server host`() {
        assertEquals("Studio Mac", workspaceDisplayName(" Studio Mac ", "https://home.example:8000"))
        assertEquals("home.example", workspaceDisplayName(null, "https://home.example:8000/api"))
        assertEquals("192.168.1.20", workspaceDisplayName("", "192.168.1.20:8000"))
        assertNull(workspaceDisplayName(null, null))
        assertNull(workspaceDisplayName("  ", "  "))
    }
}
