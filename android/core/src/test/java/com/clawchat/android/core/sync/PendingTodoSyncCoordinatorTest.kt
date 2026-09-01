package com.clawchat.android.core.sync

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoUpdate
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PendingTodoSyncCoordinatorTest {
    private val api = mockk<ClawChatApi>()
    private val todoDao = mockk<TodoDao>(relaxed = true)
    private val store = mockk<PendingTodoUpdateStore>(relaxed = true)
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(serverState())
    }
    private val syncManager = mockk<SyncManager>(relaxed = true)
    private val coordinator = PendingTodoSyncCoordinator(
        api,
        todoDao,
        store,
        sessionStore,
        syncManager,
    )

    @Test
    fun `reconnect merges phone edits and sends only the newest timestamp`() = runTest {
        val pending = listOf(
            mutation("op-1", "2026-09-01T01:00:00Z", TodoUpdate(title = "Phone title")),
            mutation(
                "op-2",
                "2026-09-01T02:00:00Z",
                TodoUpdate(status = TaskStatus.IN_PROGRESS),
            ),
        )
        coEvery { store.forWorkspace(WORKSPACE) } returns pending
        coEvery { api.getTodo("todo-1", any()) } returns
            todo(title = "Server title", updatedAt = "2026-09-01T00:30:00Z")
        coEvery {
            api.updateTodo(
                "todo-1",
                match {
                    it.title == "Phone title" &&
                        it.status == TaskStatus.IN_PROGRESS &&
                        it.clientUpdatedAt == "2026-09-01T02:00:00Z"
                },
                any(),
            )
        } returns todo(
            title = "Phone title",
            status = TaskStatus.IN_PROGRESS,
            updatedAt = "2026-09-01T02:00:01Z",
        )

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerify(exactly = 1) { store.remove(WORKSPACE, listOf("op-1", "op-2")) }
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { it.single().title == "Phone title" })
        }
        verify(exactly = 1) { syncManager.notifyTodoChanged() }
    }

    @Test
    fun `newer server edit wins and clears older phone mutation`() = runTest {
        val pending = listOf(
            mutation("op-1", "2026-09-01T01:00:00Z", TodoUpdate(title = "Old phone title")),
        )
        coEvery { store.forWorkspace(WORKSPACE) } returns pending
        coEvery { api.getTodo("todo-1", any()) } returns
            todo(title = "Newest desktop title", updatedAt = "2026-09-01T03:00:00Z")

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerify(exactly = 0) { api.updateTodo(any(), any(), any()) }
        coVerify(exactly = 1) { store.remove(WORKSPACE, listOf("op-1")) }
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { it.single().title == "Newest desktop title" })
        }
    }

    private fun mutation(operationId: String, changedAt: String, update: TodoUpdate) =
        PendingTodoUpdate(operationId, "todo-1", update, changedAt)

    private fun todo(
        title: String,
        status: TaskStatus = TaskStatus.PENDING,
        updatedAt: String,
    ) = Todo(
        id = "todo-1",
        title = title,
        status = status,
        createdAt = "2026-09-01T00:00:00Z",
        updatedAt = updatedAt,
    )

    private companion object {
        const val WORKSPACE = "server:url:test"

        fun serverState() = AppRuntimeState(
            mode = WorkspaceMode.SERVER,
            activeSession = ActiveSession(
                token = "token",
                apiBaseUrl = "https://workspace.example",
                hostId = null,
                authMode = "manual",
            ),
            hasSavedServerSession = true,
            workspaceKey = WORKSPACE,
        )
    }
}
