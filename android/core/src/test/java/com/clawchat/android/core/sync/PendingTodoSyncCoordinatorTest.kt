package com.clawchat.android.core.sync

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.api.ReviewApi
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskCommentCreateRequest
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewDecisionResponse
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.model.ReviewStatus
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import java.io.IOException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class PendingTodoSyncCoordinatorTest {
    private val api = mockk<ClawChatApi>()
    private val reviewApi = mockk<ReviewApi>()
    private val todoDao = mockk<TodoDao>(relaxed = true)
    private val store = mockk<PendingTodoUpdateStore>(relaxed = true)
    private val reviewStore = mockk<PendingReviewDecisionStore>(relaxed = true)
    private val sessionStore = mockk<SessionStore> {
        every { runtimeState } returns flowOf(serverState())
    }
    private val syncManager = mockk<SyncManager>(relaxed = true)
    private val coordinator = PendingTodoSyncCoordinator(
        api,
        reviewApi,
        todoDao,
        store,
        reviewStore,
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
        coEvery { store.allForWorkspace(WORKSPACE) } returns pending
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
    fun `missing verdict comment replays before experiment completion`() = runTest {
        val operationId = "00000000-0000-0000-0000-000000000065"
        coEvery { store.allForWorkspace(WORKSPACE) } returns listOf(
            PendingTodoComment(
                operationId = operationId,
                todoId = "todo-1",
                content = "판정 미기록",
                changedAt = "2026-09-01T01:00:00Z",
            ),
            mutation(
                "update-1",
                "2026-09-01T02:00:00Z",
                TodoUpdate(status = TaskStatus.COMPLETED),
            ),
        )
        coEvery {
            api.createTaskComment(
                TaskCommentCreateRequest("todo-1", "판정 미기록", operationId),
                any(),
            )
        } returns TaskComment(
            id = "comment-1",
            todoId = "todo-1",
            content = "판정 미기록",
            createdBy = "user",
            createdAt = "2026-09-01T01:00:01Z",
            updatedAt = "2026-09-01T01:00:01Z",
        )
        coEvery { api.getTodo("todo-1", any()) } returns
            todo(title = "E65a", updatedAt = "2026-09-01T00:30:00Z")
        coEvery {
            api.updateTodo(
                "todo-1",
                match { it.status == TaskStatus.COMPLETED },
                any(),
            )
        } returns todo(
            title = "E65a",
            status = TaskStatus.COMPLETED,
            updatedAt = "2026-09-01T02:00:01Z",
        )

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerifyOrder {
            api.createTaskComment(any(), any())
            api.getTodo("todo-1", any())
            api.updateTodo("todo-1", any(), any())
        }
        coVerify(exactly = 1) { store.remove(WORKSPACE, listOf(operationId)) }
    }

    @Test
    fun `comment replay failure blocks experiment completion retry`() = runTest {
        val operationId = "00000000-0000-0000-0000-000000000065"
        coEvery { store.allForWorkspace(WORKSPACE) } returns listOf(
            PendingTodoComment(
                operationId = operationId,
                todoId = "todo-1",
                content = "판정 미기록",
                changedAt = "2026-09-01T01:00:00Z",
            ),
            mutation(
                "update-1",
                "2026-09-01T02:00:00Z",
                TodoUpdate(status = TaskStatus.COMPLETED),
            ),
        )
        coEvery { api.createTaskComment(any(), any()) } throws IOException("offline")

        assertEquals(PendingTodoSyncResult.RETRY, coordinator.flush())

        coVerify(exactly = 0) { api.getTodo("todo-1", any()) }
        coVerify(exactly = 0) { api.updateTodo(any(), any(), any()) }
        coVerify(exactly = 1) {
            store.recordFailure(
                WORKSPACE,
                "todo-1",
                match { it.contains("offline") },
                any(),
            )
        }
    }

    @Test
    fun `permanently rejected comment does not block a newer task update`() = runTest {
        val commentOperationId = "00000000-0000-0000-0000-000000000065"
        coEvery { store.allForWorkspace(WORKSPACE) } returns listOf(
            PendingTodoComment(
                operationId = commentOperationId,
                todoId = "todo-1",
                content = "Rejected comment",
                changedAt = "2026-09-01T01:00:00Z",
            ),
            mutation(
                "update-1",
                "2026-09-01T02:00:00Z",
                TodoUpdate(title = "New title"),
            ),
        )
        val response = Response.error<Unit>(
            422,
            "invalid comment".toResponseBody("text/plain".toMediaType()),
        )
        coEvery { api.createTaskComment(any(), any()) } throws HttpException(response)
        coEvery { api.getTodo("todo-1", any()) } returns
            todo(title = "Old title", updatedAt = "2026-09-01T00:30:00Z")
        coEvery {
            api.updateTodo(
                "todo-1",
                match { it.title == "New title" },
                any(),
            )
        } returns todo(title = "New title", updatedAt = "2026-09-01T02:00:01Z")

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerify(exactly = 1) { store.remove(WORKSPACE, listOf(commentOperationId)) }
        coVerify(exactly = 1) { api.updateTodo("todo-1", any(), any()) }
        coVerify(exactly = 0) { store.recordFailure(WORKSPACE, "todo-1", any(), any()) }
    }

    @Test
    fun `newer server edit wins and clears older phone mutation`() = runTest {
        val pending = listOf(
            mutation("op-1", "2026-09-01T01:00:00Z", TodoUpdate(title = "Old phone title")),
        )
        coEvery { store.allForWorkspace(WORKSPACE) } returns pending
        coEvery { api.getTodo("todo-1", any()) } returns
            todo(title = "Newest desktop title", updatedAt = "2026-09-01T03:00:00Z")

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerify(exactly = 0) { api.updateTodo(any(), any(), any()) }
        coVerify(exactly = 1) { store.remove(WORKSPACE, listOf("op-1")) }
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { it.single().title == "Newest desktop title" })
        }
    }

    @Test
    fun `offline create is replayed once and replaces its local cache id`() = runTest {
        val operationId = "00000000-0000-0000-0000-000000000077"
        val create = TodoCreate(
            title = "Offline capture",
            inboxState = "captured",
            idempotencyKey = operationId,
        )
        coEvery { store.allForWorkspace(WORKSPACE) } returns listOf(
            PendingTodoCreate(operationId, operationId, create, "2026-09-01T01:00:00Z"),
        )
        coEvery { api.createTodo(create, any()) } returns
            todo(id = "todo-server", title = "Offline capture", updatedAt = "2026-09-01T01:00:01Z")

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerify(exactly = 1) {
            todoDao.upsertAll(match { it.single().id == "todo-server" })
        }
        coVerify(exactly = 1) { todoDao.deleteById(WORKSPACE, operationId) }
        coVerify(exactly = 1) { store.removeTodo(WORKSPACE, operationId) }
    }

    @Test
    fun `queued review decision is replayed and removed`() = runTest {
        val pending = PendingReviewDecision(
            reviewId = "review-1",
            subjectId = "run-1",
            decision = ReviewDecision.APPROVED,
            note = "Looks good",
            changedAt = "2026-09-01T01:00:00Z",
        )
        coEvery { store.allForWorkspace(WORKSPACE) } returns emptyList()
        coEvery { reviewStore.forWorkspace(WORKSPACE) } returns listOf(pending)
        coEvery {
            reviewApi.decideReview(
                "review-1",
                match { it.decision == ReviewDecision.APPROVED && it.note == "Looks good" },
                any(),
            )
        } returns ReviewDecisionResponse(
            review = ReviewItem(
                id = "review-1",
                subjectType = ReviewSubjectType.AGENT_RUN,
                subjectId = "run-1",
                status = ReviewStatus.APPROVED,
                summary = "Review",
                requestedAt = "2026-09-01T00:00:00Z",
            ),
        )

        assertEquals(PendingTodoSyncResult.SUCCESS, coordinator.flush())

        coVerify(exactly = 1) { reviewStore.remove(WORKSPACE, "review-1") }
        verify(exactly = 1) { syncManager.notifyReviewChanged() }
    }

    @Test
    fun `retryable replay failure records diagnostics on the blocked task`() = runTest {
        coEvery { store.allForWorkspace(WORKSPACE) } returns listOf(
            mutation("op-1", "2026-09-01T01:00:00Z", TodoUpdate(title = "Phone edit")),
        )
        coEvery { api.getTodo("todo-1", any()) } throws IOException("offline")

        assertEquals(PendingTodoSyncResult.RETRY, coordinator.flush())

        coVerify(exactly = 1) {
            store.recordFailure(
                WORKSPACE,
                "todo-1",
                match { it.contains("offline", ignoreCase = true) },
                any(),
            )
        }
    }

    private fun mutation(operationId: String, changedAt: String, update: TodoUpdate) =
        PendingTodoUpdate(operationId, "todo-1", update, changedAt)

    private fun todo(
        id: String = "todo-1",
        title: String,
        status: TaskStatus = TaskStatus.PENDING,
        updatedAt: String,
    ) = Todo(
        id = id,
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
