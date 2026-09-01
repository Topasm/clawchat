package com.clawchat.android.feature.review

import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewDecisionResponse
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewInboxViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: ReviewRepository
    private lateinit var runRepository: AgentRunRepository
    private lateinit var syncManager: SyncManager
    private lateinit var reviewChanged: MutableSharedFlow<Unit>
    private lateinit var runChanged: MutableSharedFlow<Unit>

    private val planReview = reviewItem("review-plan", ReviewSubjectType.PLAN_PROPOSAL)
    private val runReview = reviewItem("review-run", ReviewSubjectType.AGENT_RUN)

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repository = mockk()
        runRepository = mockk()
        syncManager = mockk()
        reviewChanged = MutableSharedFlow(extraBufferCapacity = 4)
        runChanged = MutableSharedFlow(extraBufferCapacity = 4)
        every { syncManager.reviewChanged } returns reviewChanged
        every { syncManager.runChanged } returns runChanged
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = ReviewInboxViewModel(repository, runRepository, syncManager)

    @Test
    fun `initial load exposes pending reviews`() = runTest {
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(planReview, runReview))

        val viewModel = viewModel()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isLoading)
        assertEquals(listOf(planReview, runReview), viewModel.uiState.value.items)
        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun `plan and artifact reviews stay read only without full source`() = runTest {
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(planReview))
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.onAction(ReviewInboxAction.Select(planReview.id))
        viewModel.onAction(ReviewInboxAction.Decide(ReviewDecision.APPROVED))

        assertEquals(R.string.review_read_only_error, viewModel.uiState.value.errorResource)
        coVerify(exactly = 0) { repository.decide(any(), any(), any()) }
        coVerify(exactly = 0) { runRepository.getRun(any()) }
    }

    @Test
    fun `agent decision unlocks only after authoritative detail and impact load`() = runTest {
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(runReview))
        coEvery { runRepository.getRun("run-1") } returns ApiResult.Success(authoritativeRun())
        coEvery { runRepository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        coEvery {
            repository.decide(runReview, ReviewDecision.APPROVED, "looks good")
        } returns ApiResult.Success(
            ReviewDecisionResponse(runReview.copy(status = ReviewStatus.APPROVED)),
        )
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.onAction(ReviewInboxAction.Select(runReview.id))
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.canDecideSelected)

        viewModel.onAction(ReviewInboxAction.UpdateNote("  looks good  "))
        viewModel.onAction(ReviewInboxAction.Decide(ReviewDecision.APPROVED))
        advanceUntilIdle()

        coVerify { repository.decide(runReview, ReviewDecision.APPROVED, "looks good") }
        assertTrue(viewModel.uiState.value.items.isEmpty())
        assertNull(viewModel.uiState.value.selected)
    }

    @Test
    fun `missing authoritative result prevents agent decision`() = runTest {
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(runReview))
        coEvery { runRepository.getRun("run-1") } returns
            ApiResult.Success(authoritativeRun().copy(result = null))
        coEvery { runRepository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.onAction(ReviewInboxAction.Select(runReview.id))
        advanceUntilIdle()
        viewModel.onAction(ReviewInboxAction.Decide(ReviewDecision.REJECTED))

        assertFalse(viewModel.uiState.value.canDecideSelected)
        coVerify(exactly = 0) { repository.decide(any(), any(), any()) }
    }

    @Test
    fun `changes requested exposes exact run follow-up target`() = runTest {
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(runReview))
        coEvery { runRepository.getRun("run-1") } returns ApiResult.Success(authoritativeRun())
        coEvery { runRepository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        coEvery {
            repository.decide(runReview, ReviewDecision.CHANGES_REQUESTED, null)
        } returns ApiResult.Success(
            ReviewDecisionResponse(runReview.copy(status = ReviewStatus.CHANGES_REQUESTED)),
        )
        val viewModel = viewModel()
        advanceUntilIdle()
        viewModel.onAction(ReviewInboxAction.Select(runReview.id))
        advanceUntilIdle()

        viewModel.onAction(ReviewInboxAction.Decide(ReviewDecision.CHANGES_REQUESTED))
        advanceUntilIdle()

        assertEquals("run-1", viewModel.uiState.value.followUpRunId)
        assertEquals(
            R.string.review_changes_requested_notice,
            viewModel.uiState.value.noticeResource,
        )
    }

    @Test
    fun `newer refresh wins over a stale initial response`() = runTest {
        val stale = CompletableDeferred<ApiResult<List<ReviewItem>>>()
        var calls = 0
        coEvery { repository.listPending() } coAnswers {
            if (calls++ == 0) stale.await() else ApiResult.Success(listOf(runReview))
        }
        val viewModel = viewModel()
        runCurrent()

        viewModel.refresh()
        runCurrent()
        stale.complete(ApiResult.Success(listOf(planReview)))
        advanceUntilIdle()

        assertEquals(listOf(runReview), viewModel.uiState.value.items)
    }

    @Test
    fun `review websocket invalidation refetches pending queue`() = runTest {
        coEvery { repository.listPending() } returnsMany listOf(
            ApiResult.Success(listOf(planReview)),
            ApiResult.Success(listOf(runReview)),
        )
        val viewModel = viewModel()
        advanceUntilIdle()

        reviewChanged.emit(Unit)
        advanceUntilIdle()

        assertEquals(listOf(runReview), viewModel.uiState.value.items)
        coVerify(exactly = 2) { repository.listPending() }
    }

    @Test
    fun `review decision stays locked while invalidated queue is refetching`() = runTest {
        val pendingRefresh = CompletableDeferred<ApiResult<List<ReviewItem>>>()
        var calls = 0
        coEvery { repository.listPending() } coAnswers {
            if (calls++ == 0) ApiResult.Success(listOf(runReview)) else pendingRefresh.await()
        }
        coEvery { runRepository.getRun("run-1") } returns ApiResult.Success(authoritativeRun())
        coEvery { runRepository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        val viewModel = viewModel()
        advanceUntilIdle()
        viewModel.onAction(ReviewInboxAction.Select(runReview.id))
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.canDecideSelected)

        reviewChanged.emit(Unit)
        runCurrent()

        assertTrue(viewModel.uiState.value.isRefreshing)
        assertFalse(viewModel.uiState.value.canDecideSelected)
        viewModel.onAction(ReviewInboxAction.Decide(ReviewDecision.APPROVED))
        coVerify(exactly = 0) { repository.decide(any(), any(), any()) }

        pendingRefresh.complete(ApiResult.Success(listOf(runReview)))
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.canDecideSelected)
    }

    @Test
    fun `run websocket invalidation refreshes selected waiting review detail`() = runTest {
        val first = authoritativeRun().copy(progressMessage = "Finishing")
        val updated = authoritativeRun().copy(progressMessage = "Ready")
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(runReview))
        coEvery { runRepository.getRun("run-1") } returnsMany listOf(
            ApiResult.Success(first), ApiResult.Success(updated),
        )
        coEvery { runRepository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        val viewModel = viewModel()
        advanceUntilIdle()
        viewModel.onAction(ReviewInboxAction.Select(runReview.id))
        advanceUntilIdle()

        runChanged.emit(Unit)
        advanceUntilIdle()

        assertEquals("Ready", viewModel.uiState.value.selectedRun?.progressMessage)
    }

    @Test
    fun `detail cannot close while decision response is pending`() = runTest {
        val pending = CompletableDeferred<ApiResult<ReviewDecisionResponse>>()
        coEvery { repository.listPending() } returns ApiResult.Success(listOf(runReview))
        coEvery { runRepository.getRun("run-1") } returns ApiResult.Success(authoritativeRun())
        coEvery { runRepository.listEvents("run-1") } returns ApiResult.Success(emptyList())
        coEvery { repository.decide(any(), any(), any()) } coAnswers { pending.await() }
        val viewModel = viewModel()
        advanceUntilIdle()
        viewModel.onAction(ReviewInboxAction.Select(runReview.id))
        advanceUntilIdle()

        viewModel.onAction(ReviewInboxAction.Decide(ReviewDecision.APPROVED))
        runCurrent()
        viewModel.onAction(ReviewInboxAction.CloseDetail)

        assertEquals(runReview.id, viewModel.uiState.value.selected?.id)
        assertTrue(viewModel.uiState.value.isSubmitting)
        pending.complete(ApiResult.Error("Conflict", 409))
        advanceUntilIdle()
        assertEquals("Conflict", viewModel.uiState.value.error)
    }

    private fun reviewItem(id: String, subjectType: ReviewSubjectType) = ReviewItem(
        id = id,
        subjectType = subjectType,
        subjectId = if (subjectType == ReviewSubjectType.AGENT_RUN) "run-1" else "subject-$id",
        subjectTitle = "Review $id",
        subjectHref = "/runs?run_id=run-1",
        summary = "Needs a decision",
        riskLevel = ReviewRiskLevel.HIGH,
        requestedAt = "2026-08-31T12:00:00Z",
        metadata = if (subjectType == ReviewSubjectType.AGENT_RUN) {
            buildJsonObject {
                put("approval_impact", buildJsonObject {
                    put("todo_id", JsonPrimitive("todo-1"))
                    put("graph_revision", JsonPrimitive(7))
                    put("newly_ready_tasks", buildJsonArray {})
                })
            }
        } else {
            buildJsonObject {}
        },
    )

    private fun authoritativeRun() = AgentRun(
        id = "run-1",
        agentTaskId = "agent-task-1",
        taskType = "implementation",
        instruction = "Implement it",
        instructionSnapshot = "Implement the reviewed Android change",
        attempt = 1,
        provider = "codex_cli",
        status = AgentRunStatus.WAITING_REVIEW,
        progress = 100,
        resultSummary = "Implemented and tested the change",
        result = "Full provider result with files, commands, and verification evidence",
        createdAt = "2026-08-31T01:00:00Z",
        updatedAt = "2026-08-31T01:01:00Z",
    )
}
