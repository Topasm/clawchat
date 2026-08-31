package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.LocalEventDao
import com.clawchat.android.core.data.local.LocalEventSearchRow
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.local.LocalTodoSearchRow
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val todoDao = mockk<LocalTodoDao>()
    private val eventDao = mockk<LocalEventDao>()
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(
            AppRuntimeState(
                mode = WorkspaceMode.LOCAL,
                activeSession = null,
                hasSavedServerSession = false,
                workspaceKey = "local",
            ),
        )
    }
    private val repository = SearchRepositoryImpl(api, todoDao, eventDao, sessionStore)

    @Test
    fun `local search matches task and event title or description without API`() = runTest {
        coEvery { todoDao.search("%plan%", 30) } returns listOf(
            localTodo("task-title", "Plan experiment", null),
            localTodo("task-description", "Notes", "Draft PLAN here"),
        )
        coEvery { eventDao.search("%plan%", 30) } returns listOf(
            localEvent("event-description", "Meeting", "Review the plan"),
        )

        val result = repository.search("plan")

        assertEquals(
            setOf("task-title", "task-description", "event-description"),
            (result as ApiResult.Success).data.mapTo(mutableSetOf()) { it.id },
        )
        coVerify(exactly = 0) { api.search(any()) }
    }

    @Test
    fun `message-only local search is empty without reading local tables`() = runTest {
        val result = repository.search("hello", setOf(SearchType.Messages))

        assertEquals(emptyList<Any>(), (result as ApiResult.Success).data)
        coVerify(exactly = 0) { todoDao.search(any(), any()) }
        coVerify(exactly = 0) { eventDao.search(any(), any()) }
        coVerify(exactly = 0) { api.search(any()) }
    }

    @Test
    fun `local search escapes SQL wildcard characters`() = runTest {
        coEvery { todoDao.search("%100\\%\\_done%", 2) } returns emptyList()

        repository.search("100%_done", setOf(SearchType.Tasks), limit = 2)

        coVerify(exactly = 1) { todoDao.search("%100\\%\\_done%", 2) }
        coVerify(exactly = 0) { eventDao.search(any(), any()) }
    }

    private fun localTodo(id: String, title: String, description: String?) = LocalTodoSearchRow(
        id = id,
        title = title,
        description = description,
        createdAt = "2026-08-31T00:00:00Z",
    )

    private fun localEvent(id: String, title: String, description: String?) = LocalEventSearchRow(
        id = id,
        title = title,
        description = description,
        createdAt = "2026-08-31T00:00:00Z",
    )
}
