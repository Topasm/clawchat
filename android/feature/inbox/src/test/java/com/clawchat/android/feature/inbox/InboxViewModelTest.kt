package com.clawchat.android.feature.inbox

import app.cash.turbine.test
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
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
class InboxViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var todoRepository: TodoRepository
    private lateinit var syncManager: SyncManager
    private lateinit var viewModel: InboxViewModel

    private val capturedTodo = Todo(
        id = "1",
        title = "Captured item",
        status = "pending",
        inboxState = "captured",
    )

    private val planReadyTodo = Todo(
        id = "2",
        title = "Plan ready item",
        status = "pending",
        inboxState = "plan_ready",
    )

    private val planningTodo = Todo(
        id = "3",
        title = "Planning item",
        status = "pending",
        inboxState = "planning",
    )

    private val errorTodo = Todo(
        id = "4",
        title = "Error item",
        status = "pending",
        inboxState = "error",
    )

    private val regularTodo = Todo(
        id = "5",
        title = "Regular task",
        status = "pending",
        inboxState = "none",
    )

    private val allTodos = listOf(capturedTodo, planReadyTodo, planningTodo, errorTodo, regularTodo)

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        todoRepository = mockk()
        syncManager = mockk(relaxed = true)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): InboxViewModel {
        return InboxViewModel(todoRepository, syncManager)
    }

    @Test
    fun `initial load success categorizes inbox items`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = allTodos, total = 5))

        viewModel = createViewModel()

        viewModel.uiState.test {
            // Initial state
            val initial = awaitItem()
            assertEquals(true, initial.isLoading)

            // Loaded state
            val loaded = awaitItem()
            assertEquals(false, loaded.isLoading)
            assertEquals(1, loaded.needsOrganizing.size)
            assertEquals("1", loaded.needsOrganizing.first().id)
            assertEquals(1, loaded.reviewSuggestion.size)
            assertEquals("2", loaded.reviewSuggestion.first().id)
            assertEquals(1, loaded.planningNow.size)
            assertEquals("3", loaded.planningNow.first().id)
            assertEquals(1, loaded.failed.size)
            assertEquals("4", loaded.failed.first().id)
            assertNull(loaded.error)
        }
    }

    @Test
    fun `initial load error sets error state`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Error("Network error")

        viewModel = createViewModel()

        viewModel.uiState.test {
            awaitItem() // initial loading
            val errorState = awaitItem()
            assertEquals(false, errorState.isLoading)
            assertEquals("Network error", errorState.error)
        }
    }

    @Test
    fun `organize moves item to planningNow on success`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = allTodos, total = 5))
        coEvery { todoRepository.organizeTodo("1") } returns ApiResult.Success(Unit)

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        val stateBefore = viewModel.uiState.value
        assertEquals(1, stateBefore.needsOrganizing.size)
        assertEquals(1, stateBefore.planningNow.size)

        viewModel.onAction(InboxAction.Organize("1"))
        testDispatcher.scheduler.advanceUntilIdle()

        val stateAfter = viewModel.uiState.value
        assertEquals(0, stateAfter.needsOrganizing.size)
        assertEquals(2, stateAfter.planningNow.size)
        assertEquals("planning", stateAfter.planningNow.last().inboxState)

        coVerify { todoRepository.organizeTodo("1") }
    }

    @Test
    fun `organize sets error on API failure`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = listOf(capturedTodo), total = 1))
        coEvery { todoRepository.organizeTodo("1") } returns
            ApiResult.Error("Failed to organize")

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(InboxAction.Organize("1"))
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals("Failed to organize", viewModel.uiState.value.error)
        // Item should still be in needsOrganizing
        assertEquals(1, viewModel.uiState.value.needsOrganizing.size)
    }

    @Test
    fun `retryOrganize delegates to organize`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = listOf(errorTodo), total = 1))
        coEvery { todoRepository.organizeTodo("4") } returns ApiResult.Success(Unit)

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(InboxAction.RetryOrganize("4"))
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify { todoRepository.organizeTodo("4") }
        assertEquals(0, viewModel.uiState.value.failed.size)
        assertEquals(1, viewModel.uiState.value.planningNow.size)
    }

    @Test
    fun `refresh sets isRefreshing and reloads`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = allTodos, total = 5))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val loaded = awaitItem()
            assertEquals(false, loaded.isRefreshing)

            viewModel.onAction(InboxAction.Refresh)
            val refreshing = awaitItem()
            assertEquals(true, refreshing.isRefreshing)

            val refreshed = awaitItem()
            assertEquals(false, refreshed.isRefreshing)
        }
    }
}
