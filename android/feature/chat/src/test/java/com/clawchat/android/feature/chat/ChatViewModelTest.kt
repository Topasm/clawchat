package com.clawchat.android.feature.chat

import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ChatPlanProposal
import com.clawchat.android.core.data.model.ChatPlanStep
import com.clawchat.android.core.data.model.ChatPlanApplyRequest
import com.clawchat.android.core.data.model.ChatPlanApplyResult
import com.clawchat.android.core.data.repository.ConversationRepository
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ChatStreamer
import com.clawchat.android.core.network.SseEvent
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
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
class ChatViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: ConversationRepository
    private lateinit var streamer: ChatStreamer
    private lateinit var agentRuns: AgentRunRepository
    private lateinit var reviews: ReviewRepository

    private val conversation = Conversation(id = "c1", title = "First")

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repository = mockk()
        streamer = mockk()
        agentRuns = mockk()
        reviews = mockk()
        coEvery { repository.listConversations() } returns
            ApiResult.Success(PaginatedResponse(items = listOf(conversation), total = 1))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = ChatViewModel(repository, streamer, agentRuns, reviews)

    private fun message(id: String, role: String, content: String) =
        Message(id = id, content = content, role = role, createdAt = "2026-08-29T09:00:00")

    /** A view model already showing `c1`, which is what sending requires. */
    private fun selectedViewModel(messages: List<Message> = emptyList()): ChatViewModel {
        coEvery { repository.getMessages("c1") } returns
            ApiResult.Success(PaginatedResponse(items = messages, total = messages.size))
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.selectConversation("c1")
        dispatcher.scheduler.advanceUntilIdle()
        return viewModel
    }

    @Test
    fun `conversations load on start`() = runTest {
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf("c1"), viewModel.uiState.value.conversations.map { it.id })
        assertFalse(viewModel.uiState.value.isLoadingConversations)
    }

    @Test
    fun `a failed load reports the error and stops loading`() = runTest {
        coEvery { repository.listConversations() } returns ApiResult.Error("offline")

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("offline", viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isLoadingConversations)
    }

    @Test
    fun `selecting a conversation shows its messages oldest first`() = runTest {
        // The server returns newest first.
        val viewModel = selectedViewModel(
            listOf(message("m2", "assistant", "second"), message("m1", "user", "first")),
        )

        assertEquals(listOf("m1", "m2"), viewModel.uiState.value.messages.map { it.id })
        assertEquals("c1", viewModel.uiState.value.selectedConversationId)
        assertFalse(viewModel.uiState.value.isLoadingMessages)
    }

    @Test
    fun `a new conversation goes to the top and becomes the selected one`() = runTest {
        val created = Conversation(id = "c2", title = "New Conversation")
        coEvery { repository.createConversation(any()) } returns ApiResult.Success(created)

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.createConversation("New Conversation")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf("c2", "c1"), viewModel.uiState.value.conversations.map { it.id })
        assertEquals("c2", viewModel.uiState.value.selectedConversationId)
    }

    @Test
    fun `deleting a conversation removes it from the list`() = runTest {
        coEvery { repository.deleteConversation("c1") } returns ApiResult.Success(Unit)

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.deleteConversation("c1")
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value.conversations.isEmpty())
    }

    // The row leaves the list right away; a failure has to bring it back
    // rather than leaving the user unsure whether the delete took.
    @Test
    fun `a failed delete restores the conversation and reports why`() = runTest {
        coEvery { repository.deleteConversation("c1") } returns ApiResult.Error("offline")

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.deleteConversation("c1")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf("c1"), viewModel.uiState.value.conversations.map { it.id })
        assertEquals("offline", viewModel.uiState.value.error)
    }

    @Test
    fun `sending needs a conversation and a non-blank message`() = runTest {
        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        // Nothing selected yet.
        viewModel.sendMessage("hello")
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(viewModel.uiState.value.messages.isEmpty())
        assertFalse(viewModel.uiState.value.isStreaming)

        val selected = selectedViewModel()
        selected.sendMessage("   ")
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(selected.uiState.value.messages.isEmpty())
        assertFalse(selected.uiState.value.isStreaming)
    }

    @Test
    fun `tokens reach the screen in batches and the answer lands complete`() = runTest {
        every { streamer.stream("c1", "hi") } returns flowOf(
            SseEvent.Token("a"),
            SseEvent.Token("b"),
            SseEvent.Token("c"),
            SseEvent.Token("d"),
            SseEvent.Token("e"),
        )

        val viewModel = selectedViewModel()
        viewModel.sendMessage("hi")
        dispatcher.scheduler.advanceUntilIdle()

        // Four tokens flush; the fifth waits for the next batch or the end.
        assertEquals("abcd", viewModel.uiState.value.streamingText)
        assertTrue(viewModel.uiState.value.isStreaming)
    }

    @Test
    fun `done appends the assistant answer and ends the stream`() = runTest {
        every { streamer.stream("c1", "hi") } returns flowOf(
            SseEvent.Token("Hello"),
            SseEvent.Token(" there"),
            SseEvent.Done,
        )

        val viewModel = selectedViewModel()
        viewModel.sendMessage("hi")
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(listOf("user", "assistant"), state.messages.map { it.role })
        assertEquals("Hello there", state.messages.last().content)
        assertEquals("", state.streamingText)
        assertFalse(state.isStreaming)
    }

    @Test
    fun `a generated title renames that conversation only`() = runTest {
        coEvery { repository.listConversations() } returns ApiResult.Success(
            PaginatedResponse(
                items = listOf(conversation, Conversation(id = "other", title = "Other")),
                total = 2,
            ),
        )
        every { streamer.stream("c1", "hi") } returns flowOf(
            SseEvent.TitleGenerated("Trip planning"),
            SseEvent.Done,
        )

        val viewModel = selectedViewModel()
        viewModel.sendMessage("hi")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(
            listOf("Trip planning", "Other"),
            viewModel.uiState.value.conversations.map { it.title },
        )
    }

    @Test
    fun `a stream error ends the stream and is reported`() = runTest {
        every { streamer.stream("c1", "hi") } returns flowOf(
            SseEvent.Error("Not connected to a server"),
        )

        val viewModel = selectedViewModel()
        viewModel.sendMessage("hi")
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("Not connected to a server", viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isStreaming)
    }

    @Test
    fun `stopping keeps what the assistant had already said`() = runTest {
        // A stream that stays open after two tokens, like a live answer.
        val open = MutableSharedFlow<SseEvent>(replay = 2)
        open.tryEmit(SseEvent.Token("Half an "))
        open.tryEmit(SseEvent.Token("answer"))
        every { streamer.stream("c1", "hi") } returns open

        val viewModel = selectedViewModel()
        viewModel.sendMessage("hi")
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(viewModel.uiState.value.isStreaming)

        viewModel.stopStreaming()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isStreaming)
        assertEquals("Half an answer", state.messages.last().content)
        assertEquals("assistant", state.messages.last().role)
    }

    @Test
    fun `stopping before any token leaves no empty answer behind`() = runTest {
        every { streamer.stream("c1", "hi") } returns flow { kotlinx.coroutines.awaitCancellation() }

        val viewModel = selectedViewModel()
        viewModel.sendMessage("hi")
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.stopStreaming()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isStreaming)
        assertEquals(listOf("user"), state.messages.map { it.role })
        assertNull(state.error)
    }

    @Test
    fun `run cards route answers permissions and reviews to their repositories`() = runTest {
        coEvery { agentRuns.resumeRun("run-1", "Use the short version") } returns
            ApiResult.Error("resume failed")
        coEvery { agentRuns.resolvePermission("run-1", true) } returns
            ApiResult.Error("permission failed")
        coEvery { reviews.decideById("review-1", ReviewDecision.APPROVED) } returns
            ApiResult.Error("review failed")
        val viewModel = selectedViewModel()

        viewModel.resumeRun("run-1", "Use the short version")
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.resolvePermission("run-1", true)
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.decideReview("review-1", true)
        dispatcher.scheduler.advanceUntilIdle()

        coVerify { agentRuns.resumeRun("run-1", "Use the short version") }
        coVerify { agentRuns.resolvePermission("run-1", true) }
        coVerify { reviews.decideById("review-1", ReviewDecision.APPROVED) }
        assertEquals("review failed", viewModel.uiState.value.error)
    }

    @Test
    fun `late response from previous conversation cannot replace selection`() = runTest {
        val delayed = CompletableDeferred<ApiResult<PaginatedResponse<Message>>>()
        coEvery { repository.getMessages("c1") } coAnswers { withContext(NonCancellable) { delayed.await() } }
        coEvery { repository.getMessages("c2") } returns ApiResult.Success(
            PaginatedResponse(items = listOf(message("new", "assistant", "Second"))))
        val vm = viewModel()
        vm.selectConversation("c1")
        dispatcher.scheduler.runCurrent()
        vm.selectConversation("c2")
        dispatcher.scheduler.runCurrent()
        delayed.complete(ApiResult.Success(PaginatedResponse(items = listOf(message("old", "assistant", "First")))))
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("c2", vm.uiState.value.selectedConversationId)
        assertEquals(listOf("new"), vm.uiState.value.messages.map { it.id })
    }

    @Test
    fun `clearing selection cancels pending messages`() = runTest {
        val delayed = CompletableDeferred<ApiResult<PaginatedResponse<Message>>>()
        coEvery { repository.getMessages("c1") } coAnswers { withContext(NonCancellable) { delayed.await() } }
        val vm = viewModel()
        vm.selectConversation("c1")
        dispatcher.scheduler.runCurrent()
        vm.sendMessage("Do not send into a loading thread")
        coVerify(exactly = 0) { streamer.stream(any(), any()) }
        vm.clearSelection()
        delayed.complete(ApiResult.Success(PaginatedResponse(items = listOf(message("old", "assistant", "First")))))
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(vm.uiState.value.selectedConversationId)
        assertTrue(vm.uiState.value.messages.isEmpty())
        assertFalse(vm.uiState.value.isLoadingMessages)
    }

    private fun runMessage(id: String) = message(id, "assistant", "Question").copy(metadata = buildJsonObject {
        put("action_type", "run_update")
        put("run_id", "r1")
        put("status", "waiting_input")
    })

    @Test
    fun `only newest question on live matching run has actions`() = runTest {
        val run = mockk<AgentRun>()
        every { run.conversationId } returns "c1"
        every { run.status } returns AgentRunStatus.WAITING_INPUT
        coEvery { agentRuns.getRun("r1") } returns ApiResult.Success(run)
        val vm = selectedViewModel(listOf(runMessage("new"), runMessage("old")))
        assertFalse(vm.uiState.value.messages[0].runUpdate!!.actionsLive)
        assertTrue(vm.uiState.value.messages[1].runUpdate!!.actionsLive)

        every { run.status } returns AgentRunStatus.COMPLETED
        vm.refreshConversation()
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm.uiState.value.messages.none { it.runUpdate!!.actionsLive })

        every { run.status } returns AgentRunStatus.WAITING_INPUT
        every { run.conversationId } returns "another-thread"
        vm.refreshConversation()
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm.uiState.value.messages.none { it.runUpdate!!.actionsLive })
    }

    @Test
    fun `changes request needs note and repeated submits are ignored`() = runTest {
        coEvery { reviews.decideById("review", ReviewDecision.CHANGES_REQUESTED, "Fix mobile") } returns ApiResult.Error("offline")
        val vm = selectedViewModel()
        vm.decideReview("review", ReviewDecision.CHANGES_REQUESTED, "  ")
        coVerify(exactly = 0) { reviews.decideById(any(), any(), any()) }
        vm.decideReview("review", ReviewDecision.CHANGES_REQUESTED, " Fix mobile ")
        vm.decideReview("review", ReviewDecision.CHANGES_REQUESTED, " Fix mobile ")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { reviews.decideById("review", ReviewDecision.CHANGES_REQUESTED, "Fix mobile") }
        assertFalse(vm.uiState.value.isRunActionPending)
        assertEquals("offline", vm.uiState.value.error)
    }

    @Test
    fun `proposal stays preview until apply and passes revision then supports undo`() = runTest {
        val plan = ChatPlanProposal("p1", "t1", "draft", 12, subtasks = listOf(ChatPlanStep("Mobile")))
        coEvery { repository.getPlan("t1", "p1") } returns plan.let { ApiResult.Success(it) }
        coEvery { repository.applyPlan("t1", ChatPlanApplyRequest("p1", 12)) } coAnswers {
            coEvery { repository.getPlan("t1", "p1") } returns ApiResult.Success(plan.copy(status = "applied"))
            ApiResult.Success(ChatPlanApplyResult("change1", true))
        }
        coEvery { repository.undoPlan("change1") } returns ApiResult.Success(Unit)
        val vm = selectedViewModel(listOf(message("proposal", "assistant", "Preview").copy(metadata = buildJsonObject {
            put("plan_proposal_id", "p1")
            put("todo_id", "t1")
        })))
        assertTrue(vm.uiState.value.plans.getValue("p1").canApply)
        coVerify(exactly = 0) { repository.applyPlan(any(), any()) }
        vm.planAction("p1", "apply")
        vm.planAction("p1", "apply")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.applyPlan("t1", ChatPlanApplyRequest("p1", 12)) }
        assertFalse(vm.uiState.value.plans.getValue("p1").canApply)
        assertEquals("change1", vm.uiState.value.planChanges["p1"])
        vm.planAction("p1", "undo")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.undoPlan("change1") }
        assertTrue(vm.uiState.value.pendingPlans.isEmpty())
        assertFalse(vm.uiState.value.planChanges.containsKey("p1"))
    }

    @Test
    fun `new chat session restores undo from server and removes it when graph changed`() = runTest {
        val plan = ChatPlanProposal("p1", "t1", "applied", changeSetId = "durable", canUndo = true)
        coEvery { repository.getPlan("t1", "p1") } returns ApiResult.Success(plan)
        val vm = selectedViewModel(listOf(message("p", "assistant", "Plan").copy(metadata = buildJsonObject {
            put("plan_proposal_id", "p1")
            put("todo_id", "t1")
        })))
        assertEquals("durable", vm.uiState.value.planChanges["p1"])
        coEvery { repository.getPlan("t1", "p1") } returns ApiResult.Success(plan.copy(canUndo = false))
        vm.refreshConversation()
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(vm.uiState.value.planChanges.containsKey("p1"))
    }
}
