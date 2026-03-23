package com.clawchat.android.feature.today

import app.cash.turbine.test
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TodayViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var todayRepository: TodayRepository
    private lateinit var todoRepository: TodoRepository
    private lateinit var syncManager: SyncManager
    private lateinit var viewModel: TodayViewModel

    private val sampleTodo = Todo(
        id = "1",
        title = "Today task",
        status = "pending",
    )

    private val sampleOverdueTodo = Todo(
        id = "2",
        title = "Overdue task",
        status = "pending",
    )

    private val sampleTodayResponse = TodayResponse(
        greeting = "Good morning!",
        todayTodos = listOf(sampleTodo),
        overdueTodos = listOf(sampleOverdueTodo),
        todayEvents = emptyList(),
        inboxCount = 3,
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        todayRepository = mockk()
        todoRepository = mockk()
        syncManager = mockk(relaxed = true)
        every { syncManager.todoChanged } returns MutableSharedFlow()
        every { syncManager.eventChanged } returns MutableSharedFlow()
        coEvery { todayRepository.getBriefing() } returns ApiResult.Error("Unavailable")
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): TodayViewModel {
        return TodayViewModel(todayRepository, todoRepository, syncManager)
    }

    @Test
    fun `initial refresh success populates state`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("Good morning!", state.greeting)
        assertEquals(1, state.todayTodos.size)
        assertEquals(1, state.overdueTodos.size)
        assertEquals(3, state.inboxCount)
        assertEquals(false, state.isRefreshing)
        assertNull(state.error)
    }

    @Test
    fun `initial refresh error sets error state`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Error("Connection refused")

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(false, state.isRefreshing)
        assertEquals("Connection refused", state.error)
    }

    @Test
    fun `toggleComplete on today todo optimistically updates`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        coEvery { todoRepository.updateTodo("1", any()) } returns
            ApiResult.Success(sampleTodo.copy(status = "completed"))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val current = awaitItem()
            assertEquals("pending", current.todayTodos.first().status)

            viewModel.onAction(TodayAction.ToggleComplete("1"))
            val optimistic = awaitItem()
            assertEquals("completed", optimistic.todayTodos.first().status)
        }

        coVerify { todoRepository.updateTodo("1", TodoUpdate(status = "completed")) }
    }

    @Test
    fun `toggleComplete rolls back on API failure`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        coEvery { todoRepository.updateTodo("1", any()) } returns
            ApiResult.Error("Server error")

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val loaded = awaitItem()
            assertEquals("pending", loaded.todayTodos.first().status)

            viewModel.onAction(TodayAction.ToggleComplete("1"))
            // Optimistic update
            val optimistic = awaitItem()
            assertEquals("completed", optimistic.todayTodos.first().status)
            // Rollback
            val rolledBack = awaitItem()
            assertEquals("pending", rolledBack.todayTodos.first().status)
        }
    }

    @Test
    fun `toggleComplete on overdue todo updates correctly`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        coEvery { todoRepository.updateTodo("2", any()) } returns
            ApiResult.Success(sampleOverdueTodo.copy(status = "completed"))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val current = awaitItem()
            assertEquals("pending", current.overdueTodos.first().status)

            viewModel.onAction(TodayAction.ToggleComplete("2"))
            val optimistic = awaitItem()
            assertEquals("completed", optimistic.overdueTodos.first().status)
        }

        coVerify { todoRepository.updateTodo("2", TodoUpdate(status = "completed")) }
    }

    @Test
    fun `createTask triggers refresh on success`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        coEvery { todoRepository.createTodo(any()) } returns
            ApiResult.Success(Todo(id = "new", title = "Quick", status = "pending"))
        val input = TodoCreate(
            title = "Quick",
            description = "From sheet",
            priority = "high",
            dueDate = "2026-03-23",
            source = "quick_capture",
            inboxState = "classifying",
        )

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TodayAction.Create(input))
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify { todoRepository.createTodo(input) }
        coVerify(atLeast = 2) { todayRepository.getToday() }
    }

    @Test
    fun `createTask with blank title is ignored`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(
            TodayAction.Create(
                TodoCreate(
                    title = "  ",
                    source = "quick_capture",
                    inboxState = "classifying",
                ),
            ),
        )
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { todoRepository.createTodo(any()) }
    }

    @Test
    fun `setDueToday moves overdue todo into today list`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        coEvery { todoRepository.updateTodo("2", any()) } returns
            ApiResult.Success(sampleOverdueTodo.copy(dueDate = java.time.LocalDate.now().toString()))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.setDueToday("2")
        testDispatcher.scheduler.advanceUntilIdle()

        val updated = viewModel.uiState.value
        assertEquals(0, updated.overdueTodos.size)
        assertEquals(2, updated.todayTodos.size)
        assertEquals("2", updated.todayTodos.last().id)

        coVerify {
            todoRepository.updateTodo(
                "2",
                TodoUpdate(dueDate = java.time.LocalDate.now().toString()),
            )
        }
    }
}
