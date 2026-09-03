package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.common.WidgetState
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class TodoWidgetSnapshotLoaderTest {

    private val horizonDays = 7

    private fun dueIn(days: Long): String = LocalDate.now().plusDays(days).atTime(23, 59).toString()

    private fun page(todos: List<Todo>) = PaginatedResponse(items = todos, total = todos.size)

    @Test
    fun `unconfigured workspace does not start a repository fetch`() = runTest {
        var fetches = 0

        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { runtime(WorkspaceMode.UNCONFIGURED, null) },
            loadDeadlines = {
                fetches++
                ApiResult.Success(page(emptyList()))
            },
        )

        assertTrue(snapshot.state is WidgetState.NotLoggedIn)
        assertEquals(null, snapshot.workspaceKey)
        assertEquals(0, fetches)
    }

    @Test
    fun `stable workspace publishes its fetched model`() = runTest {
        val state = runtime(WorkspaceMode.LOCAL, "local")

        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { state },
            loadDeadlines = {
                ApiResult.Success(page(listOf(Todo("todo-1", "Write", dueDate = dueIn(1)))))
            },
        )

        assertEquals("local", snapshot.workspaceKey)
        val success = snapshot.state as WidgetState.Success
        assertEquals(listOf("todo-1"), success.data.items.map { it.id })
    }

    @Test
    fun `temporary server failure replays cached deadlines`() = runTest {
        val state = runtime(WorkspaceMode.SERVER, "server:a")

        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { state },
            loadDeadlines = { ApiResult.Error("offline") },
            loadCachedTodos = { listOf(Todo("cached", "Cached task", dueDate = dueIn(2))) },
        )

        val success = snapshot.state as WidgetState.Success
        assertEquals(listOf("cached"), success.data.items.map { it.id })
    }

    // The cache is whatever was last synced, not the horizon slice, so a task
    // outside the window must not reappear through the offline path.
    @Test
    fun `cached tasks beyond the horizon stay off the widget`() = runTest {
        val state = runtime(WorkspaceMode.SERVER, "server:a")

        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { state },
            loadDeadlines = { ApiResult.Error("offline") },
            loadCachedTodos = { listOf(Todo("far", "Next month", dueDate = dueIn(40))) },
        )

        assertTrue(snapshot.state is WidgetState.Error)
    }

    @Test
    fun `workspace switch discards a late response and scopes the next render`() = runTest {
        val states = ArrayDeque(
            listOf(
                runtime(WorkspaceMode.SERVER, "server:a"),
                runtime(WorkspaceMode.SERVER, "server:b"),
            ),
        )

        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { states.removeFirst() },
            loadDeadlines = {
                ApiResult.Success(page(listOf(Todo("private-a", "A", dueDate = dueIn(0)))))
            },
        )

        assertTrue(snapshot.state is WidgetState.Loading)
        assertEquals("server:b", snapshot.workspaceKey)
    }

    @Test
    fun `logout during fetch discards the response`() = runTest {
        val states = ArrayDeque(
            listOf(
                runtime(WorkspaceMode.SERVER, "server:a"),
                runtime(WorkspaceMode.UNCONFIGURED, null),
            ),
        )

        val snapshot = loadTodoWidgetSnapshot(
            horizonDays = horizonDays,
            runtimeState = { states.removeFirst() },
            loadDeadlines = { ApiResult.Success(page(emptyList())) },
        )

        assertTrue(snapshot.state is WidgetState.NotLoggedIn)
        assertEquals(null, snapshot.workspaceKey)
    }

    private fun runtime(mode: WorkspaceMode, workspaceKey: String?) = AppRuntimeState(
        mode = mode,
        activeSession = null,
        hasSavedServerSession = mode == WorkspaceMode.SERVER,
        workspaceKey = workspaceKey,
    )
}
