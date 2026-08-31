package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.CachedToday
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.widget.common.WidgetState
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TodoWidgetSnapshotLoaderTest {
    @Test
    fun `unconfigured workspace does not start a repository fetch`() = runTest {
        var fetches = 0

        val snapshot = loadTodoWidgetSnapshot(
            runtimeState = { runtime(WorkspaceMode.UNCONFIGURED, null) },
            loadToday = {
                fetches++
                ApiResult.Success(TodayResponse())
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
            runtimeState = { state },
            loadToday = {
                ApiResult.Success(TodayResponse(todayTodos = listOf(Todo("todo-1", "Write"))))
            },
        )

        assertEquals("local", snapshot.workspaceKey)
        val success = snapshot.state as WidgetState.Success
        assertEquals(listOf("todo-1"), success.data.today.map { it.id })
    }

    @Test
    fun `temporary server failure replays cached today tasks`() = runTest {
        val state = runtime(WorkspaceMode.SERVER, "server:a")

        val snapshot = loadTodoWidgetSnapshot(
            runtimeState = { state },
            loadToday = { ApiResult.Error("offline") },
            loadCachedToday = {
                CachedToday(todayTodos = listOf(Todo("cached", "Cached task")))
            },
        )

        val success = snapshot.state as WidgetState.Success
        assertEquals(listOf("cached"), success.data.today.map { it.id })
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
            runtimeState = { states.removeFirst() },
            loadToday = {
                ApiResult.Success(TodayResponse(todayTodos = listOf(Todo("private-a", "A"))))
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
            runtimeState = { states.removeFirst() },
            loadToday = { ApiResult.Success(TodayResponse()) },
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
