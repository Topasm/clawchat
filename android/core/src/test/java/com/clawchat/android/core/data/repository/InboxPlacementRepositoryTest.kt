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

class InboxPlacementRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val sessions = mockk<SessionStore>()
    private val runtime = MutableStateFlow(AppRuntimeState(
        WorkspaceMode.SERVER, ActiveSession("test-token", "https://a.example", null, "manual"), true, "server-a",
    ))
    private val owner = ExpectedSessionScope("https://a.example")
    private fun repository(): InboxPlacementRepository {
        every { sessions.runtimeState } returns runtime
        return InboxPlacementRepository(api, sessions, mockk())
    }

    @Test fun `load pins all requests and excludes ordinary or closed tasks from old servers`() = runTest {
        val captured = Todo("t", "Capture", inboxState = "captured")
        coEvery { api.listTodos(any(), owner) } returns PaginatedResponse(items = listOf(
            captured, Todo("other", "Ordinary"), captured.copy(id = "done", status = TaskStatus.COMPLETED),
        ), total = 3)
        coEvery { api.listProjects(owner) } returns emptyList()
        coEvery { api.getInboxGraph(owner) } returns InboxGraph(3)
        coEvery { api.getInboxReview(owner) } returns InboxReviewState()
        val result = repository().load(owner, 2) as ApiResult.Success
        assertEquals(listOf("t"), result.data.tasks.map { it.id })
        coVerify { api.listTodos(mapOf("inbox_state" to "captured", "status" to "pending", "limit" to "50", "page" to "2"), owner) }
        coVerifyOrder { api.getInboxGraph(owner); api.listTodos(any(), owner); api.listProjects(owner) }
    }

    @Test fun `workspace switch rejects stale approvals without issuing a request`() = runTest {
        val repository = repository()
        runtime.value = runtime.value.copy(activeSession = ActiveSession("test-token", "https://b.example", null, "manual"))
        assertTrue(repository.approve(owner, "t", InboxPlacementRequest(null, null, "none", 1)) is ApiResult.Error)
        coVerify(exactly = 0) { api.applyInboxPlacement(any(), any(), any()) }
    }

    @Test fun `local mode never uses a saved server session for AI or undo`() = runTest {
        val repository = repository()
        runtime.value = runtime.value.copy(mode = WorkspaceMode.LOCAL)
        assertTrue(repository.preview(owner, listOf("t"), 1) is ApiResult.Error)
        assertTrue(repository.undo(owner, "change") is ApiResult.Error)
        coVerify(exactly = 0) { api.previewInboxPlacement(any(), any()) }
        coVerify(exactly = 0) { api.undoInboxPlacement(any(), any()) }
    }
}
