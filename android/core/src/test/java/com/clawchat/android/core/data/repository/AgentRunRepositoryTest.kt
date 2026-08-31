package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.AgentRunApi
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunResumeRequest
import com.clawchat.android.core.data.model.AgentRunRetryRequest
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentRunRepositoryTest {
    private val api = mockk<AgentRunApi>()
    private val repository = AgentRunRepository(api)

    private fun run(status: AgentRunStatus = AgentRunStatus.RUNNING) = AgentRun(
        id = "run-1",
        agentTaskId = "agent-task-1",
        taskType = "implementation",
        instruction = "Implement mobile controls",
        instructionSnapshot = "Implement mobile controls",
        attempt = 1,
        provider = "codex",
        status = status,
        progress = 42,
        createdAt = "2026-08-31T01:00:00Z",
        updatedAt = "2026-08-31T01:01:00Z",
    )

    @Test
    fun `list maps the status filter to its API value`() = runTest {
        coEvery { api.listRuns("project-1", "running", 25) } returns listOf(run())

        val result = repository.listRuns(
            projectId = "project-1",
            status = AgentRunStatus.RUNNING,
            limit = 25,
        )

        assertTrue(result is ApiResult.Success)
        assertEquals("run-1", (result as ApiResult.Success).data.single().id)
        coVerify { api.listRuns("project-1", "running", 25) }
    }

    @Test
    fun `retry trims optional follow-up guidance`() = runTest {
        val retried = run().copy(id = "run-2", attempt = 2, status = AgentRunStatus.QUEUED)
        coEvery {
            api.retryRun("run-1", AgentRunRetryRequest(followUpInstruction = "focus on tests"))
        } returns retried

        val result = repository.retryRun("run-1", "  focus on tests  ")

        assertEquals("run-2", (result as ApiResult.Success).data.id)
    }

    @Test
    fun `blank retry guidance is omitted`() = runTest {
        val retried = run().copy(id = "run-2", attempt = 2, status = AgentRunStatus.QUEUED)
        coEvery {
            api.retryRun("run-1", AgentRunRetryRequest(followUpInstruction = null))
        } returns retried

        repository.retryRun("run-1", "   ")

        coVerify { api.retryRun("run-1", AgentRunRetryRequest(followUpInstruction = null)) }
    }

    @Test
    fun `resume trims required follow-up instructions`() = runTest {
        val resumed = run(AgentRunStatus.STARTING)
        coEvery {
            api.resumeRun("run-1", AgentRunResumeRequest("continue from the failing test"))
        } returns resumed

        val result = repository.resumeRun("run-1", "  continue from the failing test  ")

        assertEquals(AgentRunStatus.STARTING, (result as ApiResult.Success).data.status)
    }

    @Test
    fun `follow-up longer than server contract is rejected before API call`() = runTest {
        val result = repository.resumeRun("run-1", "x".repeat(10_001))

        assertTrue(result is ApiResult.Error)
        coVerify(exactly = 0) { api.resumeRun(any(), any()) }
    }
}
