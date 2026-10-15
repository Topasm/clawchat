package com.clawchat.android.core.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the web's `src/app/utils/__tests__/taskStage.test.ts`. */
class TaskStageTest {
    @Test
    fun `starts a fresh task at Captured`() {
        assertEquals(
            TaskStageState(TaskStage.CAPTURE),
            taskStage(taskStatus = TaskStatus.PENDING, inboxState = "none"),
        )
    }

    @Test
    fun `puts a plan being written or waiting for approval at Plan`() {
        for (planStatus in listOf("generating", "draft", "stale", "applying")) {
            assertEquals(planStatus, TaskStage.PLAN, taskStage(taskStatus = TaskStatus.PENDING, planStatus = planStatus).stage)
        }
        assertEquals(TaskStage.PLAN, taskStage(taskStatus = TaskStatus.PENDING, inboxState = "plan_ready").stage)
        assertEquals(
            TaskStageState(TaskStage.PLAN, TaskStageException.FAILED),
            taskStage(taskStatus = TaskStatus.PENDING, planStatus = "failed"),
        )
    }

    @Test
    fun `puts every live run state at Run`() {
        for (runStatus in listOf(AgentRunStatus.QUEUED, AgentRunStatus.STARTING, AgentRunStatus.RUNNING)) {
            val state = taskStage(taskStatus = TaskStatus.IN_PROGRESS, runStatus = runStatus)
            assertEquals(runStatus.name, TaskStage.RUN, state.stage)
            assertNull(runStatus.name, state.exception)
        }
    }

    @Test
    fun `shows the two exceptions as badges on the current step`() {
        assertEquals(
            TaskStageState(TaskStage.RUN, TaskStageException.NEEDS_INPUT),
            taskStage(taskStatus = TaskStatus.IN_PROGRESS, runStatus = AgentRunStatus.WAITING_INPUT),
        )
        assertEquals(
            TaskStageState(TaskStage.RUN, TaskStageException.FAILED),
            taskStage(taskStatus = TaskStatus.IN_PROGRESS, runStatus = AgentRunStatus.FAILED),
        )
    }

    @Test
    fun `puts a result waiting on a person at Review`() {
        assertEquals(
            TaskStage.REVIEW,
            taskStage(taskStatus = TaskStatus.IN_PROGRESS, runStatus = AgentRunStatus.WAITING_REVIEW).stage,
        )
        assertEquals(TaskStage.REVIEW, taskStage(taskStatus = TaskStatus.IN_PROGRESS, pendingReviewCount = 1).stage)
    }

    @Test
    fun `lets a closed task win over a stale run status`() {
        assertEquals(
            TaskStage.DONE,
            taskStage(taskStatus = TaskStatus.COMPLETED, runStatus = AgentRunStatus.RUNNING).stage,
        )
        assertEquals(
            TaskStageState(TaskStage.DONE, cancelled = true),
            taskStage(taskStatus = TaskStatus.CANCELLED),
        )
    }

    @Test
    fun `treats a task being worked through its sub-tasks as running`() {
        assertEquals(TaskStage.RUN, taskStage(taskStatus = TaskStatus.PENDING, hasSubtasks = true).stage)
        assertEquals(TaskStage.RUN, taskStage(taskStatus = TaskStatus.PENDING, planStatus = "applied").stage)
    }

    @Test
    fun `asks for an answer while the inbox is questioning and fails a broken capture`() {
        assertEquals(
            TaskStageState(TaskStage.PLAN, TaskStageException.NEEDS_INPUT),
            taskStage(taskStatus = TaskStatus.PENDING, inboxState = "questioning"),
        )
        assertEquals(
            TaskStageState(TaskStage.CAPTURE, TaskStageException.FAILED),
            taskStage(taskStatus = TaskStatus.PENDING, inboxState = "error"),
        )
    }

    @Test
    fun `ends an adopted run at Done and a rejected one failed at Review`() {
        assertEquals(TaskStage.DONE, runStage(AgentRunStatus.COMPLETED, isAdopted = true).stage)
        assertEquals(
            TaskStageState(TaskStage.REVIEW, TaskStageException.FAILED),
            runStage(AgentRunStatus.COMPLETED, isAdopted = false),
        )
        assertTrue(runStage(AgentRunStatus.CANCELLED, isAdopted = false).cancelled)
        assertEquals(
            TaskStageState(TaskStage.RUN, TaskStageException.NEEDS_INPUT),
            runStage(AgentRunStatus.WAITING_INPUT, isAdopted = false),
        )
    }

    @Test
    fun `names the agent by its product name`() {
        assertEquals("Claude", agentName("claude_code"))
        assertEquals("Codex", agentName("codex_cli"))
        assertEquals("custom", agentName("custom"))
        assertNull(agentName(null))
        assertNull(agentName(""))
    }
}
