package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.*
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.network.*
import io.mockk.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class InboxRoutingRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val runtime = MutableStateFlow(AppRuntimeState(
        WorkspaceMode.SERVER, ActiveSession("test-token", "https://a.example", null, "manual"), true, "server-a",
    ))
    private val sessions = mockk<SessionStore> { every { runtimeState } returns runtime }
    private val owner = ExpectedSessionScope("https://a.example")
    private val repository = InboxRoutingRepository(api, sessions)
    private val routing = InboxRouting(
        id = "r", origin = "auto", kind = "task", todoId = "filed", title = "Slides",
        originalTitle = "Slides Friday", createdAt = "2030-11-01T09:00:00Z",
    )

    @Test fun `load keeps open captures in the web's order and notes each task's project`() = runTest {
        coEvery { api.listInboxRoutings(owner) } returns InboxRoutingList(listOf(routing))
        coEvery { api.listTodos(mapOf("limit" to "200", "page" to "1"), owner) } returns PaginatedResponse(items = listOf(
            Todo("captured", "Captured", inboxState = "captured"),
            Todo("filed", "Slides", inboxState = "none", projectId = "p"),
            Todo("failed", "Failed", inboxState = "error"),
            Todo("reading", "Reading", inboxState = "classifying"),
            Todo("done", "Done", inboxState = "captured", status = TaskStatus.COMPLETED),
            Todo("legacy", "No inbox state"),
        ), total = 6)
        coEvery { api.listProjects(owner) } returns listOf(ProjectPlan("p", "Thesis"))
        coEvery { api.listProjectCandidates(owner) } throws RuntimeException("404")

        val result = repository.load("server-a") as ApiResult.Success
        assertEquals(listOf("r"), result.data.routings.map { it.id })
        assertEquals(listOf("reading", "failed", "captured"), result.data.captures.map { it.id })
        assertEquals("p", result.data.projectOf["filed"])
        assertTrue(result.data.candidates.isEmpty())
        assertFalse(result.data.hasMoreTodos)
    }

    @Test fun `scrolling further reads the next page of todos`() = runTest {
        coEvery { api.listTodos(mapOf("limit" to "200", "page" to "2"), owner) } returns PaginatedResponse(
            items = listOf(Todo("old", "Old capture", inboxState = "captured")), total = 401,
        )
        val page = (repository.loadMoreCaptures("server-a", 2) as ApiResult.Success).data
        assertEquals(listOf("old"), page.captures.map { it.id })
        assertTrue(page.hasMore)
    }

    @Test fun `placing a task goes to the project root at the current graph revision`() = runTest {
        coEvery { api.getInboxGraph(owner) } returns InboxGraph(41)
        coEvery { api.applyInboxPlacement(any(), any(), owner) } returns mockk()
        assertTrue(repository.placeTask("server-a", "filed", "p") is ApiResult.Success)
        coVerify { api.applyInboxPlacement("filed", InboxPlacementRequest("p", null, "none", 41), owner) }
    }

    @Test fun `moves are pinned to the workspace they were asked in`() = runTest {
        runtime.value = runtime.value.copy(workspaceKey = "server-b")
        assertEquals(409, (repository.undo("server-a", "r") as ApiResult.Error).code)
        coVerify(exactly = 0) { api.undoInboxRouting(any(), any()) }
    }

    @Test fun `local mode never asks a server`() = runTest {
        runtime.value = runtime.value.copy(mode = WorkspaceMode.LOCAL, workspaceKey = "local")
        assertTrue(repository.load("local") is ApiResult.Error)
        coVerify(exactly = 0) { api.listInboxRoutings(any()) }
    }
}
