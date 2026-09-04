package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskCommentCreateRequest
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import java.io.IOException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskCommentRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(
            AppRuntimeState(
                mode = WorkspaceMode.SERVER,
                activeSession = ActiveSession(
                    token = "token",
                    apiBaseUrl = "https://workspace.example",
                    hostId = null,
                    authMode = "manual",
                ),
                hasSavedServerSession = true,
                workspaceKey = WORKSPACE,
            ),
        )
    }
    private val pendingUpdates = mockk<PendingTodoUpdateStore>(relaxed = true)
    private val repository = TaskCommentRepository(api, sessionStore, pendingUpdates)

    @Test
    fun `comment intent is persisted before the network request and removed after success`() =
        runTest {
            val response = comment(id = "comment-1")
            coEvery {
                api.createTaskComment(
                    TaskCommentCreateRequest(TODO_ID, CONTENT, OPERATION_ID),
                    any(),
                )
            } returns response

            val result = repository.addComment(TODO_ID, CONTENT, OPERATION_ID)

            assertEquals(response, (result as ApiResult.Success).data)
            coVerifyOrder {
                pendingUpdates.enqueueComment(
                    WORKSPACE,
                    OPERATION_ID,
                    TODO_ID,
                    CONTENT,
                    any(),
                )
                api.createTaskComment(
                    TaskCommentCreateRequest(TODO_ID, CONTENT, OPERATION_ID),
                    any(),
                )
                pendingUpdates.remove(WORKSPACE, listOf(OPERATION_ID))
            }
        }

    @Test
    fun `offline comment remains queued and returns an optimistic record`() = runTest {
        coEvery { api.createTaskComment(any(), any()) } throws IOException("offline")

        val result = repository.addComment(TODO_ID, "  $CONTENT  ", OPERATION_ID)

        assertTrue(result is ApiResult.Success)
        val optimistic = (result as ApiResult.Success).data
        assertEquals(OPERATION_ID, optimistic.id)
        assertEquals(CONTENT, optimistic.content)
        coVerify(exactly = 1) {
            pendingUpdates.enqueueComment(
                WORKSPACE,
                OPERATION_ID,
                TODO_ID,
                CONTENT,
                any(),
            )
        }
        coVerify(exactly = 1) {
            pendingUpdates.recordFailure(WORKSPACE, TODO_ID, any(), any())
        }
        coVerify(exactly = 0) { pendingUpdates.remove(WORKSPACE, any()) }
    }

    @Test
    fun `invalid comment is rejected before it enters the outbox`() = runTest {
        val result = repository.addComment(TODO_ID, "   ", OPERATION_ID)

        assertTrue(result is ApiResult.Error)
        assertEquals(422, (result as ApiResult.Error).code)
        coVerify(exactly = 0) { pendingUpdates.enqueueComment(any(), any(), any(), any(), any()) }
        coVerify(exactly = 0) { api.createTaskComment(any(), any()) }
    }

    private fun comment(id: String) = TaskComment(
        id = id,
        todoId = TODO_ID,
        content = CONTENT,
        createdBy = "user",
        createdAt = "2026-09-04T00:00:00Z",
        updatedAt = "2026-09-04T00:00:00Z",
    )

    private companion object {
        const val WORKSPACE = "server:url:test"
        const val TODO_ID = "todo-1"
        const val CONTENT = "판정 미기록"
        const val OPERATION_ID = "00000000-0000-0000-0000-000000000065"
    }
}
