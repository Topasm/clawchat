package com.clawchat.android.core.data.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentRunModelsTest {
    private fun run(
        status: AgentRunStatus,
        todoId: String? = null,
        todoStatus: TaskStatus? = null,
        adopted: Boolean = false,
    ) = AgentRun(
        id = "run-1",
        agentTaskId = "agent-task-1",
        todoId = todoId,
        todoStatus = todoStatus,
        taskType = "implementation",
        instruction = "Do the work",
        instructionSnapshot = "\nBuild the Android control plane\nThen test it",
        attempt = 1,
        provider = "codex",
        status = status,
        isAdopted = adopted,
        createdAt = "2026-08-31T00:00:00Z",
        updatedAt = "2026-08-31T00:00:00Z",
    )

    @Test
    fun `display title falls back to first nonblank instruction line`() {
        assertEquals("Build the Android control plane", run(AgentRunStatus.RUNNING).displayTitle)
    }

    @Test
    fun `waiting input can be cancelled and needs attention`() {
        val run = run(AgentRunStatus.WAITING_INPUT)

        assertTrue(run.canCancel)
        assertTrue(run.status.needsAttention)
        assertTrue(run.status.isActive)
    }

    @Test
    fun `waiting review remains active while awaiting adoption`() {
        val run = run(AgentRunStatus.WAITING_REVIEW)

        assertTrue(run.status.isActive)
        assertTrue(run.status.needsAttention)
        assertFalse(run.status.isExecuting)
    }

    @Test
    fun `task backed retry requires task to remain in progress`() {
        assertTrue(
            run(
                AgentRunStatus.FAILED,
                todoId = "todo-1",
                todoStatus = TaskStatus.IN_PROGRESS,
            ).canRetry,
        )
        assertFalse(
            run(
                AgentRunStatus.FAILED,
                todoId = "todo-1",
                todoStatus = TaskStatus.PENDING,
            ).canRetry,
        )
    }

    @Test
    fun `adopted completed run is not retryable`() {
        assertFalse(run(AgentRunStatus.COMPLETED, adopted = true).canRetry)
        assertTrue(run(AgentRunStatus.COMPLETED, adopted = false).canRetry)
    }

    @Test
    fun `detail result is optional for compact list compatibility`() {
        val base = """
            {"id":"run-1","agent_task_id":"task-1","task_type":"research",
             "instruction":"Research","instruction_snapshot":"Research","attempt":1,
             "provider":"codex_cli","status":"waiting_review","created_at":"2026-08-31T00:00:00Z",
             "updated_at":"2026-08-31T00:01:00Z"}
        """.trimIndent()
        val json = Json { ignoreUnknownKeys = true }

        assertNull(json.decodeFromString<AgentRun>(base).result)

        val detail = base.dropLast(1) + ",\"result\":\"complete provider output\"}"
        assertEquals("complete provider output", json.decodeFromString<AgentRun>(detail).result)
    }
}
