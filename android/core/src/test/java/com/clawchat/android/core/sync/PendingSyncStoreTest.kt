package com.clawchat.android.core.sync

import android.content.Context
import com.clawchat.android.core.data.local.PendingReviewDecisionDao
import com.clawchat.android.core.data.local.PendingReviewDecisionEntity
import com.clawchat.android.core.data.local.PendingTodoMutationDao
import com.clawchat.android.core.data.local.PendingTodoMutationEntity
import io.mockk.every
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import java.time.Instant
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingSyncStoreTest {

    @Test
    fun `todo status groups mutations and only exposes failure presence`() = runTest {
        val dao = mockk<PendingTodoMutationDao>()
        every { dao.observeForWorkspace(WORKSPACE) } returns flowOf(
            listOf(
                PendingTodoMutationEntity(
                    workspaceKey = WORKSPACE,
                    operationId = "create-1",
                    todoId = "local-1",
                    operationType = "create",
                    payload = """{"title":"Offline inbox","inbox_state":"captured"}""",
                    changedAt = "2026-09-01T01:00:00Z",
                ),
                PendingTodoMutationEntity(
                    workspaceKey = WORKSPACE,
                    operationId = "update-1",
                    todoId = "local-1",
                    operationType = "update",
                    payload = """{"title":"Renamed offline inbox"}""",
                    changedAt = "2026-09-01T02:00:00Z",
                    attemptCount = 2,
                    lastAttemptAt = "2026-09-01T03:00:00Z",
                    lastError = "Connection timed out",
                    nextRetryAt = "2026-09-01T03:01:00Z",
                ),
            ),
        )
        val store = PendingTodoUpdateStore(dao, mockk<Context>(relaxed = true))

        val status = store.observeStatus(WORKSPACE).first()

        assertEquals(1, status.pendingCount)
        assertTrue(status.hasFailure)
    }

    @Test
    fun `review status exposes only queue count and failure presence`() = runTest {
        val dao = mockk<PendingReviewDecisionDao>()
        every { dao.observeForWorkspace(WORKSPACE) } returns flowOf(
            listOf(
                PendingReviewDecisionEntity(
                    workspaceKey = WORKSPACE,
                    reviewId = "review-1",
                    subjectId = "run-1",
                    decision = "rejected",
                    note = null,
                    changedAt = "2026-09-01T01:00:00Z",
                ),
            ),
        )
        val store = PendingReviewDecisionStore(dao, mockk<Context>(relaxed = true))

        val status = store.observeStatus(WORKSPACE).first()

        assertEquals(1, status.pendingCount)
        assertFalse(status.hasFailure)
    }

    @Test
    fun `todo failure records exponential retry diagnostics`() = runTest {
        val dao = mockk<PendingTodoMutationDao>(relaxed = true)
        coEvery { dao.getForTodo(WORKSPACE, "todo-1") } returns listOf(
            PendingTodoMutationEntity(
                workspaceKey = WORKSPACE,
                operationId = "update-1",
                todoId = "todo-1",
                operationType = "update",
                payload = "{}",
                changedAt = "2026-09-01T01:00:00Z",
                attemptCount = 2,
            ),
        )
        val store = PendingTodoUpdateStore(dao, mockk<Context>(relaxed = true))
        val failedAt = Instant.parse("2026-09-01T03:00:00Z")

        store.recordFailure(WORKSPACE, "todo-1", "  Connection timed out  ", failedAt)

        coVerify(exactly = 1) {
            dao.recordFailure(
                workspaceKey = WORKSPACE,
                todoId = "todo-1",
                attemptedAt = "2026-09-01T03:00:00Z",
                error = "Connection timed out",
                nextRetryAt = "2026-09-01T03:02:00Z",
            )
        }
    }

    @Test
    fun `retry delay starts at thirty seconds and caps at one hour`() {
        assertEquals(30L, outboxRetryDelaySeconds(1))
        assertEquals(60L, outboxRetryDelaySeconds(2))
        assertEquals(120L, outboxRetryDelaySeconds(3))
        assertEquals(3_600L, outboxRetryDelaySeconds(20))
    }

    private companion object {
        const val WORKSPACE = "server:url:test"
    }
}
