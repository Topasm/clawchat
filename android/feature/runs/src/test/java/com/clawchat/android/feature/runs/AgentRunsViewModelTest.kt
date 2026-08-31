package com.clawchat.android.feature.runs

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AgentRunsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: AgentRunRepository
    private lateinit var syncManager: SyncManager
    private lateinit var runChanged: MutableSharedFlow<Unit>

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repository = mockk()
        syncManager = mockk()
        runChanged = MutableSharedFlow(extraBufferCapacity = 8)
        every { syncManager.runChanged } returns runChanged
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun run(
        id: String = "run-1",
        status: AgentRunStatus = AgentRunStatus.RUNNING,
        attempt: Int = 1,
        adopted: Boolean = false,
    ) = AgentRun(
        id = id,
        agentTaskId = "agent-task-$id",
        todoTitle = "Implement Android runs",
        taskType = "implementation",
        instruction = "Implement Android runs",
        instructionSnapshot = "Implement Android runs",
        attempt = attempt,
        provider = "codex",
        model = "gpt-5.6-codex",
        status = status,
        progress = 42,
        isAdopted = adopted,
        createdAt = "2026-08-31T01:00:00Z",
        updatedAt = "2026-08-31T01:01:00Z",
    )

    private fun event(runId: String = "run-1") = AgentRunEvent(
        id = "event-1",
        runId = runId,
        sequence = 1,
        eventType = "running",
        message = "Execution started",
        progress = 10,
        createdAt = "2026-08-31T01:00:10Z",
    )

    private fun viewModel(initialRuns: List<AgentRun>): AgentRunsViewModel {
        coEvery { repository.listRuns() } returns ApiResult.Success(initialRuns)
        return AgentRunsViewModel(repository, syncManager)
    }

    @Test
    fun `initial load exposes active attention and recent groups`() = runTest {
        val running = run()
        val waiting = run("run-2", AgentRunStatus.WAITING_INPUT)
        val completed = run("run-3", AgentRunStatus.COMPLETED, adopted = true)
        val viewModel = viewModel(listOf(running, waiting, completed))

        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isLoading)
        assertEquals(2, viewModel.uiState.value.activeCount)
        assertEquals(1, viewModel.uiState.value.attentionCount)

        viewModel.setFilter(AgentRunFilter.RECENT)
        assertEquals(listOf("run-3"), viewModel.uiState.value.visibleRuns.map { it.id })
    }

    @Test
    fun `selecting a run loads authoritative detail and event log`() = runTest {
        val cached = run()
        val detail = cached.copy(progress = 73, progressMessage = "Running tests")
        coEvery { repository.getRun("run-1") } returns ApiResult.Success(detail)
        coEvery { repository.listEvents("run-1") } returns ApiResult.Success(listOf(event()))
        val viewModel = viewModel(listOf(cached))
        advanceUntilIdle()

        viewModel.selectRun("run-1")
        advanceUntilIdle()

        assertEquals(73, viewModel.uiState.value.selectedRun?.progress)
        assertEquals("event-1", viewModel.uiState.value.events.single().id)
        assertFalse(viewModel.uiState.value.isDetailLoading)
    }

    @Test
    fun `exact navigation loads a run outside the compact list`() = runTest {
        val listed = run("run-listed")
        val older = run("run-older", status = AgentRunStatus.WAITING_INPUT)
        coEvery { repository.getRun("run-older") } returns ApiResult.Success(older)
        coEvery { repository.listEvents("run-older") } returns ApiResult.Success(
            listOf(event("run-older")),
        )
        val viewModel = viewModel(listOf(listed))
        advanceUntilIdle()

        viewModel.selectRun("run-older")
        advanceUntilIdle()

        assertEquals("run-older", viewModel.uiState.value.selectedRun?.id)
        assertEquals("run-older", viewModel.uiState.value.events.single().runId)
        assertEquals(listOf("run-older", "run-listed"), viewModel.uiState.value.runs.map { it.id })
        assertFalse(viewModel.uiState.value.isDetailLoading)
        coVerify(exactly = 1) { repository.getRun("run-older") }
    }

    @Test
    fun `late deep link detail cannot replace a newer selection`() = runTest {
        val stale = CompletableDeferred<ApiResult<AgentRun>>()
        val newer = run("run-newer", status = AgentRunStatus.WAITING_REVIEW)
        coEvery { repository.getRun("run-older") } coAnswers { stale.await() }
        coEvery { repository.getRun("run-newer") } returns ApiResult.Success(newer)
        coEvery { repository.listEvents("run-newer") } returns ApiResult.Success(emptyList())
        val viewModel = viewModel(emptyList())
        advanceUntilIdle()

        viewModel.selectRun("run-older")
        runCurrent()
        viewModel.selectRun("run-newer")
        advanceUntilIdle()

        stale.complete(ApiResult.Success(run("run-older")))
        advanceUntilIdle()

        assertEquals("run-newer", viewModel.uiState.value.selectedRun?.id)
        assertEquals(listOf("run-newer"), viewModel.uiState.value.runs.map { it.id })
    }

    @Test
    fun `cancel replaces the run with cancelled server state`() = runTest {
        val running = run()
        val cancelled = running.copy(status = AgentRunStatus.CANCELLED, error = "Cancelled by user")
        coEvery { repository.cancelRun("run-1") } returns ApiResult.Success(cancelled)
        val viewModel = viewModel(listOf(running))
        advanceUntilIdle()

        viewModel.cancelRun("run-1")
        advanceUntilIdle()

        assertEquals(AgentRunStatus.CANCELLED, viewModel.uiState.value.runs.single().status)
        assertEquals("Agent run cancelled", viewModel.uiState.value.notice)
        assertNull(viewModel.uiState.value.pendingOperation)
    }

    @Test
    fun `waiting run resumes only with trimmed follow-up`() = runTest {
        val waiting = run(status = AgentRunStatus.WAITING_INPUT)
        val resumed = waiting.copy(status = AgentRunStatus.STARTING, progress = 0)
        coEvery {
            repository.resumeRun("run-1", "Use the smaller API surface")
        } returns ApiResult.Success(resumed)
        val viewModel = viewModel(listOf(waiting))
        advanceUntilIdle()

        viewModel.resumeRun("run-1")
        assertEquals("Add follow-up instructions before resuming", viewModel.uiState.value.error)

        viewModel.updateFollowUp("  Use the smaller API surface  ")
        viewModel.resumeRun("run-1")
        advanceUntilIdle()

        coVerify { repository.resumeRun("run-1", "Use the smaller API surface") }
        assertEquals(AgentRunStatus.STARTING, viewModel.uiState.value.runs.single().status)
        assertEquals("", viewModel.uiState.value.followUp)
    }

    @Test
    fun `retry prepends the new attempt and carries optional guidance`() = runTest {
        val failed = run(status = AgentRunStatus.FAILED)
        val retried = run(id = "run-2", status = AgentRunStatus.QUEUED, attempt = 2)
        coEvery { repository.getRun("run-1") } returns ApiResult.Success(failed)
        coEvery { repository.getRun("run-2") } returns ApiResult.Success(retried)
        coEvery { repository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        coEvery {
            repository.retryRun("run-1", "Keep the existing tests")
        } returns ApiResult.Success(retried)
        coEvery { repository.listEvents("run-2") } returns ApiResult.Success(emptyList())
        val viewModel = viewModel(listOf(failed))
        advanceUntilIdle()

        viewModel.selectRun("run-1")
        advanceUntilIdle()
        viewModel.updateFollowUp(" Keep the existing tests ")
        viewModel.retryRun("run-1")
        advanceUntilIdle()

        assertEquals(listOf("run-2", "run-1"), viewModel.uiState.value.runs.map { it.id })
        assertEquals("run-2", viewModel.uiState.value.selectedRun?.id)
        assertEquals("New agent attempt started", viewModel.uiState.value.notice)
    }

    @Test
    fun `poll silently replaces executing progress`() = runTest {
        val running = run().copy(progress = 10)
        val updated = running.copy(progress = 80)
        coEvery { repository.listRuns() } returnsMany listOf(
            ApiResult.Success(listOf(running)),
            ApiResult.Success(listOf(updated)),
        )
        val viewModel = AgentRunsViewModel(repository, syncManager)
        advanceUntilIdle()

        viewModel.poll()
        advanceUntilIdle()

        assertEquals(80, viewModel.uiState.value.runs.single().progress)
        assertNull(viewModel.uiState.value.error)
        assertTrue(viewModel.uiState.value.hasExecutingRuns)
    }

    @Test
    fun `run invalidation refreshes waiting review that is not polled`() = runTest {
        val waiting = run(status = AgentRunStatus.WAITING_REVIEW).copy(progressMessage = "Old")
        val updated = waiting.copy(progressMessage = "Ready")
        coEvery { repository.listRuns() } returnsMany listOf(
            ApiResult.Success(listOf(waiting)),
            ApiResult.Success(listOf(updated)),
        )
        val viewModel = AgentRunsViewModel(repository, syncManager)
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.hasExecutingRuns)
        runChanged.emit(Unit)
        advanceUntilIdle()

        assertEquals("Ready", viewModel.uiState.value.runs.single().progressMessage)
        coVerify(exactly = 2) { repository.listRuns() }
    }

    @Test
    fun `poll requests coalesce behind one in flight list call`() = runTest {
        val running = run()
        val pending = CompletableDeferred<ApiResult<List<AgentRun>>>()
        var calls = 0
        coEvery { repository.listRuns() } coAnswers {
            when (calls++) {
                0 -> ApiResult.Success(listOf(running))
                1 -> pending.await()
                else -> ApiResult.Success(listOf(running.copy(progress = 90)))
            }
        }
        val viewModel = AgentRunsViewModel(repository, syncManager)
        advanceUntilIdle()

        viewModel.poll()
        runCurrent()
        viewModel.poll()
        viewModel.poll()
        runCurrent()
        coVerify(exactly = 2) { repository.listRuns() }

        pending.complete(ApiResult.Success(listOf(running.copy(progress = 70))))
        advanceUntilIdle()

        coVerify(exactly = 3) { repository.listRuns() }
        assertEquals(90, viewModel.uiState.value.runs.single().progress)
    }

    @Test
    fun `poll refreshes selected run and event log`() = runTest {
        val running = run().copy(progress = 10)
        val updated = running.copy(progress = 80)
        val oldEvent = event()
        val newEvent = oldEvent.copy(id = "event-2", sequence = 2, progress = 80)
        coEvery { repository.listRuns() } returnsMany listOf(
            ApiResult.Success(listOf(running)), ApiResult.Success(listOf(updated)),
        )
        coEvery { repository.getRun("run-1") } returnsMany listOf(
            ApiResult.Success(running), ApiResult.Success(updated),
        )
        coEvery { repository.listEvents("run-1") } returnsMany listOf(
            ApiResult.Success(listOf(oldEvent)), ApiResult.Success(listOf(oldEvent, newEvent)),
        )
        val viewModel = AgentRunsViewModel(repository, syncManager)
        advanceUntilIdle()
        viewModel.selectRun("run-1")
        advanceUntilIdle()

        viewModel.poll()
        advanceUntilIdle()

        assertEquals(80, viewModel.uiState.value.selectedRun?.progress)
        assertEquals(listOf("event-1", "event-2"), viewModel.uiState.value.events.map { it.id })
    }

    @Test
    fun `sheet state cannot close while cancel response is pending`() = runTest {
        val running = run()
        val pending = CompletableDeferred<ApiResult<AgentRun>>()
        coEvery { repository.getRun("run-1") } returns ApiResult.Success(running)
        coEvery { repository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        coEvery { repository.cancelRun("run-1") } coAnswers { pending.await() }
        val viewModel = viewModel(listOf(running))
        advanceUntilIdle()
        viewModel.selectRun("run-1")
        advanceUntilIdle()

        viewModel.cancelRun("run-1")
        runCurrent()
        viewModel.closeDetails()

        assertEquals("run-1", viewModel.uiState.value.selectedRun?.id)
        assertEquals(AgentRunOperation.CANCEL, viewModel.uiState.value.pendingOperation)
        pending.complete(ApiResult.Error("Provider timeout"))
        advanceUntilIdle()
        assertEquals("Provider timeout", viewModel.uiState.value.error)
    }

    @Test
    fun `follow up input is capped at server contract`() = runTest {
        val waiting = run(status = AgentRunStatus.WAITING_INPUT)
        val viewModel = viewModel(listOf(waiting))
        advanceUntilIdle()

        viewModel.updateFollowUp("x".repeat(10_100))

        assertEquals(10_000, viewModel.uiState.value.followUp.length)
    }
}
