package com.clawchat.android.feature.progress

import app.cash.turbine.test
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.TaskCommentRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.PendingReviewDecisionStore
import com.clawchat.android.core.sync.PendingSyncStatus
import com.clawchat.android.core.sync.PendingTodoSyncCoordinator
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProgressViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var runs: AgentRunRepository
    private lateinit var reviews: ReviewRepository
    private lateinit var todos: TodoRepository
    private lateinit var comments: TaskCommentRepository
    private lateinit var syncManager: SyncManager
    private lateinit var sessionStore: SessionStore
    private lateinit var pendingTodos: PendingTodoUpdateStore
    private lateinit var pendingReviews: PendingReviewDecisionStore
    private lateinit var pendingSync: PendingTodoSyncCoordinator

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        runs = mockk()
        reviews = mockk()
        todos = mockk()
        comments = mockk()
        syncManager = mockk()
        sessionStore = mockk()
        pendingTodos = mockk()
        pendingReviews = mockk()
        pendingSync = mockk(relaxed = true)

        every { syncManager.isConnected } returns MutableStateFlow(true)
        every { syncManager.todoChanged } returns MutableSharedFlow()
        every { syncManager.reviewChanged } returns MutableSharedFlow()
        every { syncManager.runChanged } returns MutableSharedFlow()
        every { sessionStore.runtimeState } returns flowOf(
            AppRuntimeState(
                mode = WorkspaceMode.LOCAL,
                activeSession = null,
                hasSavedServerSession = false,
                workspaceKey = "local",
            ),
        )
        every { pendingTodos.observeStatus("local") } returns flowOf(PendingSyncStatus())
        every { pendingReviews.observeStatus("local") } returns flowOf(PendingSyncStatus())
        coEvery { reviews.listPending() } returns ApiResult.Success(emptyList())
        coEvery { comments.listForTodos(any()) } returns ApiResult.Success(emptyList())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `file uses durable todo update and removes capture from Now`() = runTest {
        val capture = todo(inboxState = "captured", nextAction = "organize")
        stubInitial(todos = listOf(capture))
        coEvery {
            todos.updateTodo(capture.id, TodoUpdate(inboxState = "none"))
        } returns ApiResult.Success(capture.copy(inboxState = "none", nextAction = null))
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.fileTodo(viewModel.uiState.value.attentionItems.single(), dueToday = false)
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.attentionItems.isEmpty())
        assertNull(viewModel.uiState.value.actionError)
        coVerify(exactly = 1) {
            todos.updateTodo(capture.id, TodoUpdate(inboxState = "none"))
        }
    }

    @Test
    fun `retry run inserts the new attempt and hides stale failure`() = runTest {
        val failed = run("failed", AgentRunStatus.FAILED, attempt = 1)
        val restarted = run("restarted", AgentRunStatus.RUNNING, attempt = 2)
        stubInitial(runs = listOf(failed))
        coEvery { runs.retryRun(failed.id) } returns ApiResult.Success(restarted)
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.retryNowItem(viewModel.uiState.value.attentionItems.single())
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.attentionItems.isEmpty())
        assertEquals(listOf("restarted"), viewModel.uiState.value.executingRuns.map(AgentRun::id))
        coVerify(exactly = 1) { runs.retryRun(failed.id) }
    }

    @Test
    fun `answer trims input and resumes waiting run`() = runTest {
        val waiting = run("waiting", AgentRunStatus.WAITING_INPUT)
        stubInitial(runs = listOf(waiting))
        coEvery { runs.resumeRun(waiting.id, "Continue with option B") } returns
            ApiResult.Success(waiting.copy(status = AgentRunStatus.RUNNING))
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.answerRun(
            viewModel.uiState.value.attentionItems.single(),
            "  Continue with option B  ",
        )
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.attentionItems.isEmpty())
        assertNull(viewModel.uiState.value.actionError)
        coVerify(exactly = 1) { runs.resumeRun(waiting.id, "Continue with option B") }
    }

    @Test
    fun `answering todo questions starts planning and removes attention row`() = runTest {
        val questioning = todo(inboxState = "questioning", nextAction = "answer").copy(
            clarificationQuestions = listOf("When?", "Who?"),
        )
        stubInitial(todos = listOf(questioning))
        coEvery {
            todos.answerTodoQuestions(
                questioning.id,
                mapOf("0" to " Friday ", "1" to " Ada "),
            )
        } returns ApiResult.Success(Unit)
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.answerTodoQuestions(
            viewModel.uiState.value.attentionItems.single(),
            mapOf("0" to " Friday ", "1" to " Ada "),
        )
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.attentionItems.isEmpty())
        val updated = viewModel.uiState.value.tasks.single()
        assertEquals("planning", updated.inboxState)
        assertEquals(mapOf("0" to "Friday", "1" to "Ada"), updated.clarificationAnswers)
        coVerify(exactly = 1) {
            todos.answerTodoQuestions(
                questioning.id,
                mapOf("0" to " Friday ", "1" to " Ada "),
            )
        }
    }

    @Test
    fun `skipping todo questions starts planning`() = runTest {
        val questioning = todo(inboxState = "questioning", nextAction = "answer").copy(
            clarificationQuestions = listOf("When?"),
        )
        stubInitial(todos = listOf(questioning))
        coEvery { todos.skipTodoQuestions(questioning.id) } returns ApiResult.Success(Unit)
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.skipTodoQuestions(viewModel.uiState.value.attentionItems.single())
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.attentionItems.isEmpty())
        assertEquals("planning", viewModel.uiState.value.tasks.single().inboxState)
        coVerify(exactly = 1) { todos.skipTodoQuestions(questioning.id) }
    }

    @Test
    fun `failed action remains visible with retryable error`() = runTest {
        val capture = todo(inboxState = "captured", nextAction = "organize")
        stubInitial(todos = listOf(capture))
        coEvery { todos.updateTodo(capture.id, TodoUpdate(inboxState = "none")) } returns
            ApiResult.Error("Offline queue unavailable")
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.fileTodo(viewModel.uiState.value.attentionItems.single(), dueToday = false)
        advanceUntilIdle()

        assertEquals("todo:${capture.id}", viewModel.uiState.value.attentionItems.single().stableId)
        assertEquals("Offline queue unavailable", viewModel.uiState.value.actionError)
        assertNull(viewModel.uiState.value.pendingActionId)
    }

    @Test
    fun `capture success is delivered once and can be undone`() = runTest {
        val captured = todo(inboxState = "captured", nextAction = "organize")
        stubInitial()
        coEvery { todos.createTodo(any()) } returns ApiResult.Success(captured)
        coEvery { todos.deleteTodo(captured.id) } returns ApiResult.Success(Unit)
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.captureEvents.test {
            viewModel.captureToInbox("Task #work")
            advanceUntilIdle()

            assertEquals(captured, awaitItem())
            expectNoEvents()
        }

        viewModel.undoCapture(captured)
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.tasks.none { it.id == captured.id })
        coVerify(exactly = 1) { todos.deleteTodo(captured.id) }
    }

    @Test
    fun `loading in-progress tasks fetches their comment threads`() = runTest {
        val active = todo(id = "active-1", inboxState = "none").copy(status = TaskStatus.IN_PROGRESS)
        stubInitial(todos = listOf(active))
        val note = comment(active.id, "Halfway there")
        coEvery { comments.listForTodos(listOf(active.id)) } returns ApiResult.Success(listOf(note))
        val viewModel = viewModel()
        advanceUntilIdle()

        assertEquals(listOf(note), viewModel.uiState.value.commentsByTodoId[active.id])
    }

    @Test
    fun `addComment appends the posted comment to its thread`() = runTest {
        val active = todo(id = "active-1", inboxState = "none").copy(status = TaskStatus.IN_PROGRESS)
        stubInitial(todos = listOf(active))
        val posted = comment(active.id, "Shipping now")
        coEvery { comments.addComment(active.id, "Shipping now") } returns ApiResult.Success(posted)
        val viewModel = viewModel()
        advanceUntilIdle()

        viewModel.addComment(active.id, "  Shipping now  ")
        advanceUntilIdle()

        assertEquals(listOf(posted), viewModel.uiState.value.commentsByTodoId[active.id])
        assertNull(viewModel.uiState.value.commentError)
        coVerify(exactly = 1) { comments.addComment(active.id, "Shipping now") }
    }

    private fun comment(todoId: String, content: String, id: String = "cmt-$content") = TaskComment(
        id = id,
        todoId = todoId,
        content = content,
        createdBy = "user",
        createdAt = "2026-09-01T00:00:00Z",
        updatedAt = "2026-09-01T00:00:00Z",
    )

    private fun stubInitial(
        todos: List<Todo> = emptyList(),
        runs: List<AgentRun> = emptyList(),
    ) {
        coEvery {
            this@ProgressViewModelTest.todos.listTodos(mapOf("limit" to "200"))
        } returns ApiResult.Success(
            PaginatedResponse(items = todos, total = todos.size),
        )
        coEvery {
            this@ProgressViewModelTest.runs.listRuns(limit = 100)
        } returns ApiResult.Success(runs)
    }

    private fun viewModel() = ProgressViewModel(
        agentRunRepository = runs,
        reviewRepository = reviews,
        todoRepository = todos,
        taskCommentRepository = comments,
        syncManager = syncManager,
        sessionStore = sessionStore,
        pendingTodos = pendingTodos,
        pendingReviews = pendingReviews,
        pendingSyncCoordinator = pendingSync,
    )

    private fun todo(
        id: String = "todo-1",
        inboxState: String,
        nextAction: String? = null,
    ) = Todo(
        id = id,
        title = "Task $id",
        status = TaskStatus.PENDING,
        inboxState = inboxState,
        nextAction = nextAction,
        updatedAt = "2026-09-01T00:00:00Z",
    )

    private fun run(
        id: String,
        status: AgentRunStatus,
        attempt: Int = 1,
    ) = AgentRun(
        id = id,
        agentTaskId = "same-agent-task",
        todoId = "todo-run",
        todoTitle = "Run task",
        todoStatus = TaskStatus.IN_PROGRESS,
        taskType = "general",
        instruction = "Do work",
        instructionSnapshot = "Do work",
        attempt = attempt,
        provider = "test",
        status = status,
        createdAt = "2026-09-01T00:00:00Z",
        updatedAt = "2026-09-01T00:00:00Z",
    )
}
