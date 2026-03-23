package com.clawchat.android.feature.tasks

import app.cash.turbine.test
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
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
class TasksViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var todoRepository: TodoRepository
    private lateinit var syncManager: SyncManager
    private lateinit var viewModel: TasksViewModel

    private val sampleTodo = Todo(
        id = "1",
        title = "Test task",
        status = "pending",
    )

    private val sampleTodos = listOf(
        sampleTodo,
        Todo(id = "2", title = "Second task", status = "completed"),
    )

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

    private fun createViewModel(): TasksViewModel {
        return TasksViewModel(todoRepository, syncManager)
    }

    @Test
    fun `initial load success populates tasks`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))

        viewModel = createViewModel()

        viewModel.uiState.test {
            // Initial empty state
            val initial = awaitItem()
            assertEquals(emptyList<Todo>(), initial.tasks)

            // Loading state
            val loading = awaitItem()
            assertEquals(true, loading.isLoading)

            // Loaded state
            val loaded = awaitItem()
            assertEquals(sampleTodos, loaded.tasks)
            assertEquals(false, loaded.isLoading)
            assertNull(loaded.error)
        }
    }

    @Test
    fun `initial load error sets error state`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Error("Network error")

        viewModel = createViewModel()

        viewModel.uiState.test {
            awaitItem() // initial
            awaitItem() // loading
            val errorState = awaitItem()
            assertEquals(false, errorState.isLoading)
            assertEquals("Network error", errorState.error)
        }
    }

    @Test
    fun `toggleComplete optimistically updates then confirms`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))
        coEvery { todoRepository.updateTodo("1", any()) } returns
            ApiResult.Success(sampleTodo.copy(status = "completed"))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val current = awaitItem()
            assertEquals("pending", current.tasks.first { it.id == "1" }.status)

            viewModel.onAction(TasksAction.ToggleComplete("1"))
            // Optimistic update
            val optimistic = awaitItem()
            assertEquals("completed", optimistic.tasks.first { it.id == "1" }.status)
        }

        coVerify { todoRepository.updateTodo("1", TodoUpdate(status = "completed")) }
    }

    @Test
    fun `toggleComplete rolls back on API failure`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = listOf(sampleTodo), total = 1))
        coEvery { todoRepository.updateTodo("1", any()) } returns
            ApiResult.Error("Server error")

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val loaded = awaitItem()
            assertEquals("pending", loaded.tasks.first().status)

            viewModel.onAction(TasksAction.ToggleComplete("1"))
            // Optimistic update
            val optimistic = awaitItem()
            assertEquals("completed", optimistic.tasks.first().status)
            // Rollback
            val rolledBack = awaitItem()
            assertEquals("pending", rolledBack.tasks.first().status)
        }
    }

    @Test
    fun `setFilter updates filter and reloads`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        coEvery { todoRepository.listTodos(match { it["status"] == "completed" }) } returns
            ApiResult.Success(PaginatedResponse(items = listOf(sampleTodos[1]), total = 1))

        viewModel.onAction(TasksAction.SetFilter("completed"))
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals("completed", viewModel.uiState.value.statusFilter)
        assertEquals(1, viewModel.uiState.value.tasks.size)
    }

    @Test
    fun `createTask adds task to beginning of list`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        val newTodo = Todo(id = "new", title = "New task", status = "pending")
        coEvery { todoRepository.createTodo(any()) } returns ApiResult.Success(newTodo)

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TasksAction.Create("New task"))
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.tasks.size)
        assertEquals("New task", viewModel.uiState.value.tasks.first().title)
        coVerify { todoRepository.createTodo(TodoCreate(title = "New task")) }
    }

    @Test
    fun `deleteTask removes task from list`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))
        coEvery { todoRepository.deleteTodo("1") } returns ApiResult.Success(Unit)

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TasksAction.Delete("1"))
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.tasks.size)
        assertEquals("2", viewModel.uiState.value.tasks.first().id)
    }

    @Test
    fun `selectTask updates selectedTask`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TasksAction.SelectTask(sampleTodo))
        assertEquals(sampleTodo, viewModel.uiState.value.selectedTask)

        viewModel.onAction(TasksAction.SelectTask(null))
        assertNull(viewModel.uiState.value.selectedTask)
    }
}
