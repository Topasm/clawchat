package com.clawchat.android.feature.today

import app.cash.turbine.test
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
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

        viewModel.uiState.test {
            // Initial empty
            val initial = awaitItem()
            assertEquals("", initial.greeting)

            // Refreshing
            val refreshing = awaitItem()
            assertEquals(true, refreshing.isRefreshing)

            // Loaded
            val loaded = awaitItem()
            assertEquals("Good morning!", loaded.greeting)
            assertEquals(1, loaded.todayTodos.size)
            assertEquals(1, loaded.overdueTodos.size)
            assertEquals(3, loaded.inboxCount)
            assertEquals(false, loaded.isRefreshing)
            assertNull(loaded.error)
        }
    }

    @Test
    fun `initial refresh error sets error state`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Error("Connection refused")

        viewModel = createViewModel()

        viewModel.uiState.test {
            awaitItem() // initial
            awaitItem() // refreshing
            val errorState = awaitItem()
            assertEquals(false, errorState.isRefreshing)
            assertEquals("Connection refused", errorState.error)
        }
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
    fun `quickAdd triggers refresh on success`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        coEvery { todoRepository.createTodo(any()) } returns
            ApiResult.Success(Todo(id = "new", title = "Quick", status = "pending"))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TodayAction.QuickAdd("Quick"))
        testDispatcher.scheduler.advanceUntilIdle()

        // createTodo called, then refresh (getToday) called again
        coVerify(atLeast = 2) { todayRepository.getToday() }
    }

    @Test
    fun `quickAdd with blank title is ignored`() = runTest {
        coEvery { todayRepository.getToday() } returns ApiResult.Success(sampleTodayResponse)
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TodayAction.QuickAdd("  "))
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { todoRepository.createTodo(any()) }
    }
}
