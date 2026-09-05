package com.clawchat.android.feature.inbox

import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.data.repository.InboxPlacementRepository
import com.clawchat.android.core.data.repository.InboxPlacementSnapshot
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.sync.SyncManager
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class InboxPlacementViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<InboxPlacementRepository>()
    private val sync = mockk<SyncManager>(relaxed = true)
    private val scope = ExpectedSessionScope("server-a")
    private val scopes = MutableStateFlow<ExpectedSessionScope?>(scope)
    private val task = Todo("t", "Paper figures", inboxState = "captured")
    private val project = ProjectPlan("p", "Paper", rootTaskId = "root")
    private val snapshot = InboxPlacementSnapshot(listOf(task), 1, listOf(project), InboxGraph(17))
    private val preview = InboxTriagePreview(17, listOf(InboxTriageSuggestion("t", "p", reason = "Related paper")))
    private var savedReview = InboxReviewState()

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        every { repository.scopes } returns scopes
        every { sync.todoChanged } returns MutableSharedFlow()
        coEvery { repository.load(scope, any()) } coAnswers { ApiResult.Success(snapshot.copy(review = savedReview)) }
        coEvery { repository.saveReview(scope, any(), any()) } coAnswers {
            val id = secondArg<String>()
            val update = thirdArg<InboxReviewUpdate>()
            val old = savedReview.items.find { it.taskId == id } ?: InboxReviewItem(id)
            val next = old.copy(deferred = update.deferred ?: old.deferred,
                excludeDeadline = update.excludeDeadline ?: old.excludeDeadline,
                choice = update.choice ?: old.choice, choiceRevision = update.revision ?: old.choiceRevision)
            savedReview = InboxReviewState(savedReview.items.filterNot { it.taskId == id } + next)
            ApiResult.Success(Unit)
        }
        coEvery { repository.resumeReview(scope) } coAnswers {
            savedReview = InboxReviewState(savedReview.items.map { it.copy(deferred = false) })
            ApiResult.Success(Unit)
        }
        coEvery { repository.preview(scope, listOf("t"), 17) } returns ApiResult.Success(preview)
    }
    @After fun teardown() { Dispatchers.resetMain() }
    private fun loaded(): InboxPlacementViewModel {
        val vm = InboxPlacementViewModel(repository, sync)
        dispatcher.scheduler.advanceUntilIdle()
        return vm
    }

    @Test fun `opening inbox generates preview without modifying tasks`() = runTest {
        val vm = loaded()
        assertEquals("p", vm.uiState.value.choices["t"]?.projectId)
        coVerify(exactly = 1) { repository.preview(scope, listOf("t"), 17) }
        coVerify(exactly = 0) { repository.approve(any(), any(), any()) }
    }

    @Test fun `editor saves branch and deadline preference together before closing`() = runTest {
        val branch = ProjectNode("chapter", "Chapter", "root", "task", "pending")
        coEvery { repository.load(scope, any()) } returns ApiResult.Success(snapshot.copy(graph = InboxGraph(17, listOf(branch))))
        val pending = CompletableDeferred<ApiResult<Unit>>()
        coEvery { repository.saveReview(scope, "t", any()) } coAnswers { pending.await() }
        val vm = loaded()
        var closed = false
        vm.editPlacement("t", PlacementChoice("p", "chapter"), false, 17) { closed = true }
        dispatcher.scheduler.runCurrent()
        assertFalse(closed)
        assertTrue(vm.uiState.value.busy)
        coVerify { repository.saveReview(scope, "t", InboxReviewUpdate(
            excludeDeadline = true, choice = InboxReviewChoice("p", "chapter"), revision = 17)) }
        pending.complete(ApiResult.Success(Unit))
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(closed)
        assertEquals("chapter", vm.uiState.value.choices["t"]?.parentId)
        assertTrue("t" in vm.uiState.value.excludedDeadlines)
        coVerify(exactly = 0) { repository.approve(any(), any(), any()) }
    }

    @Test fun `failed editor save keeps existing choice and does not close`() = runTest {
        coEvery { repository.saveReview(scope, "t", any()) } returns ApiResult.Error("offline")
        val vm = loaded()
        var closed = false
        vm.editPlacement("t", PlacementChoice(null, null), false, 17) { closed = true }
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(closed)
        assertEquals("p", vm.uiState.value.choices["t"]?.projectId)
        assertTrue(vm.uiState.value.stale)
        assertFalse("t" in vm.uiState.value.excludedDeadlines)
    }

    @Test fun `editor rejects descendants and foreign project parents`() = runTest {
        val nodes = listOf(ProjectNode("t", "Task", "root", "task", "pending"),
            ProjectNode("child", "Child", "t", "task", "pending"),
            ProjectNode("foreign", "Other", "other-root", "task", "pending"))
        coEvery { repository.load(scope, any()) } returns ApiResult.Success(snapshot.copy(graph = InboxGraph(17, nodes)))
        val vm = loaded()
        for (parent in listOf("t", "child", "foreign")) {
            vm.editPlacement("t", PlacementChoice("p", parent), true, 17) { fail("Invalid choice saved") }
        }
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 0) { repository.saveReview(any(), any(), any()) }
    }

    @Test fun `editor does not rebase a draft onto a newer revision`() = runTest {
        val vm = loaded()
        vm.editPlacement("t", PlacementChoice(null, null), true, 16) { fail("Stale draft saved") }
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 0) { repository.saveReview(any(), any(), any()) }
    }

    @Test fun `approval includes displayed deadline and location in one request`() = runTest {
        val deadline = InboxDeadlineSuggestion("t", "2026-09-04T14:59:59Z", "2026-09-04", "Asia/Seoul", "금요일까지", true)
        coEvery { repository.preview(any(), any(), any()) } returns ApiResult.Success(preview.copy(deadlines = listOf(deadline)))
        coEvery { repository.approve(any(), any(), any()) } returns ApiResult.Error("offline")
        val vm = loaded()
        assertEquals(deadline, vm.uiState.value.deadlines["t"])
        coVerify(exactly = 0) { repository.approve(any(), any(), any()) }
        vm.approve("t")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify { repository.approve(scope, "t", InboxPlacementRequest("p", null, "none", 17, deadline.dueDate)) }
    }

    @Test fun `unchecking a proposed deadline preserves current date on approval`() = runTest {
        val deadline = InboxDeadlineSuggestion("t", "2026-09-04T14:59:59Z", "2026-09-04", "Asia/Seoul", "금요일까지", true)
        coEvery { repository.preview(any(), any(), any()) } returns ApiResult.Success(preview.copy(deadlines = listOf(deadline)))
        coEvery { repository.approve(any(), any(), any()) } returns ApiResult.Error("offline")
        val vm = loaded()
        vm.includeDeadline("t", false)
        vm.refresh()
        dispatcher.scheduler.advanceUntilIdle()
        vm.approve("t")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify { repository.approve(scope, "t", InboxPlacementRequest("p", null, "none", 17)) }
    }

    @Test fun `approval sends exact revision once and preserves undo identity`() = runTest {
        val pending = CompletableDeferred<ApiResult<InboxPlacementResult>>()
        coEvery { repository.approve(any(), any(), any()) } coAnswers { pending.await() }
        val vm = loaded()
        vm.approve("t")
        vm.approve("t")
        dispatcher.scheduler.runCurrent()
        assertTrue(vm.uiState.value.busy)
        coVerify(exactly = 1) { repository.approve(scope, "t", InboxPlacementRequest("p", null, "none", 17)) }
        coEvery { repository.load(scope, any()) } returns ApiResult.Success(snapshot.copy(tasks = emptyList(), total = 0))
        pending.complete(ApiResult.Success(InboxPlacementResult(task.copy(inboxState = "none"), 18, "change")))
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("change", vm.uiState.value.applied?.changeSetId)
        coEvery { repository.undo(scope, "change") } returns ApiResult.Success(InboxPlacementResult(task, 19, "change"))
        vm.undo()
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.undo(scope, "change") }
        assertNull(vm.uiState.value.applied)
    }

    @Test fun `conflict invalidates all approval choices without retrying mutation`() = runTest {
        coEvery { repository.approve(any(), any(), any()) } returns ApiResult.Error("Stale revision", 409)
        val vm = loaded()
        vm.approve("t")
        dispatcher.scheduler.advanceUntilIdle()
        vm.approve("t")
        assertTrue(vm.uiState.value.stale)
        assertTrue(vm.uiState.value.choices.isEmpty())
        coVerify(exactly = 1) { repository.approve(any(), any(), any()) }
    }

    @Test fun `unassigned capture requires explicit selection before standalone approval`() = runTest {
        coEvery { repository.preview(any(), any(), any()) } returns ApiResult.Success(InboxTriagePreview(17, emptyList(), listOf("t")))
        coEvery { repository.approve(any(), any(), any()) } returns ApiResult.Error("offline")
        val vm = loaded()
        vm.approve("t")
        coVerify(exactly = 0) { repository.approve(any(), any(), any()) }
        vm.choose("t", null)
        dispatcher.scheduler.advanceUntilIdle()
        vm.approve("t")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify { repository.approve(scope, "t", InboxPlacementRequest(null, null, "none", 17)) }
    }

    @Test fun `new parent proposals are not silently changed into project root placement`() = runTest {
        coEvery { repository.preview(any(), any(), any()) } returns ApiResult.Success(preview.copy(
            suggestions = listOf(preview.suggestions.single().copy(proposedParentKey = "new-branch")),
        ))
        assertTrue(loaded().uiState.value.choices.isEmpty())
    }

    @Test fun `deferred capture cannot be approved and is not automatically reproposed`() = runTest {
        val vm = loaded()
        vm.defer("t")
        vm.approve("t")
        vm.refresh()
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.preview(any(), any(), any()) }
        coVerify(exactly = 0) { repository.approve(any(), any(), any()) }
    }

    @Test fun `workspace switch discards late preview and clears undo and choices`() = runTest {
        val pending = CompletableDeferred<ApiResult<InboxTriagePreview>>()
        coEvery { repository.preview(any(), any(), any()) } coAnswers { withContext(NonCancellable) { pending.await() } }
        val vm = InboxPlacementViewModel(repository, sync)
        dispatcher.scheduler.runCurrent()
        scopes.value = null
        dispatcher.scheduler.runCurrent()
        pending.complete(ApiResult.Success(preview))
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(vm.uiState.value.server)
        assertNull(vm.uiState.value.snapshot)
        assertTrue(vm.uiState.value.choices.isEmpty())
    }

    @Test fun `local mode never calls AI`() = runTest {
        scopes.value = null
        val vm = loaded()
        assertFalse(vm.uiState.value.server)
        coVerify(exactly = 0) { repository.load(any(), any()) }
    }

    @Test fun `next page loads older captures`() = runTest {
        coEvery { repository.load(scope, any()) } returns ApiResult.Success(snapshot.copy(total = 65))
        val vm = loaded()
        vm.changePage(1)
        dispatcher.scheduler.advanceUntilIdle()
        coVerify { repository.load(scope, 2) }
        assertEquals(2, vm.uiState.value.page)
    }

    @Test fun `capture saves raw input once and retains operation identity across retry`() = runTest {
        val calls = mutableListOf<String>()
        val timestamps = mutableListOf<String>()
        coEvery { repository.capture(scope, "금요일까지 논문 초안 작성", capture(calls), capture(timestamps)) } returns ApiResult.Error("offline")
        val vm = loaded()
        vm.editCapture("금요일까지 논문 초안 작성")
        vm.capture()
        vm.capture()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, calls.size)
        assertEquals("금요일까지 논문 초안 작성", vm.uiState.value.captureText)
        vm.capture()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(2, calls.size)
        assertEquals(calls[0], calls[1])
        assertEquals(timestamps[0], timestamps[1])
        coEvery { repository.capture(any(), any(), any(), any()) } returns ApiResult.Success(task)
        vm.capture()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("", vm.uiState.value.captureText)
        assertTrue(vm.uiState.value.captureSaved)
    }

    @Test fun `recreated viewmodel restores deferred date exclusion and explicit standalone choice`() = runTest {
        val first = loaded()
        first.choose("t", null)
        dispatcher.scheduler.advanceUntilIdle()
        first.includeDeadline("t", false)
        dispatcher.scheduler.advanceUntilIdle()
        first.defer("t")
        dispatcher.scheduler.advanceUntilIdle()
        val reopened = loaded()
        assertTrue("t" in reopened.uiState.value.deferred)
        assertTrue("t" in reopened.uiState.value.excludedDeadlines)
        assertEquals(PlacementChoice(null, null), reopened.uiState.value.choices["t"])
        reopened.resumeDeferred()
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(reopened.uiState.value.deferred.isEmpty())
        assertEquals(PlacementChoice(null, null), reopened.uiState.value.choices["t"])
    }

    @Test fun `failed preference save does not pretend a task was deferred`() = runTest {
        coEvery { repository.saveReview(any(), any(), any()) } returns ApiResult.Error("offline")
        val vm = loaded()
        vm.defer("t")
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm.uiState.value.deferred.isEmpty())
        assertTrue(vm.uiState.value.stale)
    }

    @Test fun `saved manual choice at an old revision is not silently restored`() = runTest {
        savedReview = InboxReviewState(listOf(InboxReviewItem("t", choice = InboxReviewChoice(null, null), choiceRevision = 16)))
        assertEquals("p", loaded().uiState.value.choices["t"]?.projectId)
    }
}
