package com.clawchat.android.feature.progress

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressUiStateTest {

    @Test
    fun `task progress and agent execution remain separate`() {
        val state = ProgressUiState(
            runs = listOf(run("run-running", AgentRunStatus.RUNNING)),
            tasks = listOf(
                Todo(id = "manual", title = "Manual work", status = TaskStatus.IN_PROGRESS),
                Todo(id = "ready", title = "Ready", status = TaskStatus.PENDING),
            ),
        )

        assertEquals(listOf("run-running"), state.executingRuns.map(AgentRun::id))
        assertEquals(listOf("manual"), state.inProgressTasks.map(Todo::id))
        assertEquals(2, state.activeCount)
    }

    @Test
    fun `review-backed waiting run appears once in attention`() {
        val waitingRun = run("run-review", AgentRunStatus.WAITING_REVIEW)
        val state = ProgressUiState(
            runs = listOf(waitingRun, run("run-input", AgentRunStatus.WAITING_INPUT)),
            reviews = listOf(review(subjectId = waitingRun.id)),
        )

        assertEquals(
            listOf("run:run-input", "review:review-run-review"),
            state.attentionItems.map(NowItem::stableId),
        )
        assertEquals(2, state.attentionCount)
    }

    @Test
    fun `inbox actions are included in the single attention count`() {
        val state = ProgressUiState(
            tasks = listOf(
                Todo(id = "question", title = "Question", inboxState = "questioning"),
                Todo(id = "capture", title = "Capture", inboxState = "captured"),
                Todo(id = "planning", title = "Planning", inboxState = "planning"),
            ),
        )

        assertEquals(listOf(NowAction.ANSWER, NowAction.FILE), state.attentionItems.map(NowItem::action))
        assertEquals(2, state.attentionCount)
        assertEquals(1, state.processingCount)
    }

    @Test
    fun `inbox and pending tasks do not become active progress`() {
        val state = ProgressUiState(
            tasks = listOf(
                Todo(
                    id = "inbox",
                    title = "Inbox item",
                    status = TaskStatus.IN_PROGRESS,
                    inboxState = "needs_organizing",
                ),
                Todo(id = "pending", title = "Pending", status = TaskStatus.PENDING),
            ),
        )

        assertTrue(state.inProgressTasks.isEmpty())
        assertFalse(state.hasAnyContent)
    }

    @Test
    fun `pending task mutations are visible in sync summary`() {
        val state = ProgressUiState(
            pendingSyncCount = 1,
            tasks = listOf(
                Todo(id = "one", title = "One", syncStatus = "pending"),
                Todo(id = "two", title = "Two", syncStatus = "synced"),
            ),
        )

        assertEquals(1, state.pendingSyncCount)
        assertTrue(state.hasAnyContent)
    }

    private fun run(id: String, status: AgentRunStatus) = AgentRun(
        id = id,
        agentTaskId = "agent-$id",
        taskType = "general",
        instruction = "Do work",
        instructionSnapshot = "Do work",
        attempt = 1,
        provider = "test",
        status = status,
        createdAt = "2026-09-01T00:00:00Z",
        updatedAt = "2026-09-01T00:00:00Z",
    )

    private fun review(subjectId: String) = ReviewItem(
        id = "review-$subjectId",
        subjectType = ReviewSubjectType.AGENT_RUN,
        subjectId = subjectId,
        summary = "Check the result",
        riskLevel = ReviewRiskLevel.MEDIUM,
        requestedAt = "2026-09-01T00:00:00Z",
    )
}
