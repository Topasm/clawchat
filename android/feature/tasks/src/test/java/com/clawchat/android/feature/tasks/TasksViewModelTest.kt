package com.clawchat.android.feature.tasks

import app.cash.turbine.test
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.data.repository.TaskRelationshipRepository
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
class TasksViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var todoRepository: TodoRepository
    private lateinit var relationshipRepository: TaskRelationshipRepository
    private lateinit var syncManager: SyncManager
    private lateinit var todoChanged: MutableSharedFlow<Unit>
    private lateinit var viewModel: TasksViewModel

    private val sampleTodo = Todo(
        id = "1",
        title = "Test task",
        status = TaskStatus.PENDING,
    )

    private val sampleTodos = listOf(
        sampleTodo,
        Todo(id = "2", title = "Second task", status = TaskStatus.COMPLETED),
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        todoRepository = mockk()
        relationshipRepository = mockk()
        syncManager = mockk(relaxed = true)
        todoChanged = MutableSharedFlow(extraBufferCapacity = 1)
        every { syncManager.todoChanged } returns todoChanged
        coEvery { relationshipRepository.listForTask(any()) } returns ApiResult.Success(emptyList())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): TasksViewModel {
        return TasksViewModel(todoRepository, syncManager, relationshipRepository)
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
            ApiResult.Success(sampleTodo.copy(status = TaskStatus.COMPLETED))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.uiState.test {
            val current = awaitItem()
            assertEquals(TaskStatus.PENDING, current.tasks.first { it.id == "1" }.status)

            viewModel.onAction(TasksAction.ToggleComplete("1"))
            // Optimistic update
            val optimistic = awaitItem()
            assertEquals(TaskStatus.COMPLETED, optimistic.tasks.first { it.id == "1" }.status)
        }

        coVerify { todoRepository.updateTodo("1", TodoUpdate(status = TaskStatus.COMPLETED)) }
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
            assertEquals(TaskStatus.PENDING, loaded.tasks.first().status)

            viewModel.onAction(TasksAction.ToggleComplete("1"))
            // Optimistic update
            val optimistic = awaitItem()
            assertEquals(TaskStatus.COMPLETED, optimistic.tasks.first().status)
            // Rollback
            val rolledBack = awaitItem()
            assertEquals(TaskStatus.PENDING, rolledBack.tasks.first().status)
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

        viewModel.onAction(TasksAction.SetFilter(TaskStatus.COMPLETED))
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(TaskStatus.COMPLETED, viewModel.uiState.value.statusFilter)
        assertEquals(1, viewModel.uiState.value.tasks.size)
    }

    @Test
    fun `createTask adds task to beginning of list`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        val newTodo = Todo(id = "new", title = "New task", status = TaskStatus.PENDING)
        coEvery { todoRepository.createTodo(any()) } returns ApiResult.Success(newTodo)
        val input = TodoCreate(
            title = "New task",
            description = "Notes",
            priority = "high",
            dueDate = "2026-03-23",
            source = "quick_capture",
            inboxState = "classifying",
        )

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(TasksAction.Create(input))
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.tasks.size)
        assertEquals("New task", viewModel.uiState.value.tasks.first().title)
        coVerify { todoRepository.createTodo(input) }
    }

    @Test
    fun `createTask with blank title is ignored`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(
            TasksAction.Create(
                TodoCreate(
                    title = "   ",
                    source = "quick_capture",
                    inboxState = "classifying",
                ),
            ),
        )
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 0) { todoRepository.createTodo(any()) }
    }

    @Test
    fun `setDueToday sends current date update`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))
        coEvery { todoRepository.updateTodo("1", any()) } returns
            ApiResult.Success(sampleTodo.copy(dueDate = java.time.LocalDate.now().toString()))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.setDueToday("1")
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify {
            todoRepository.updateTodo(
                "1",
                TodoUpdate(dueDate = java.time.LocalDate.now().toString()),
            )
        }
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

    @Test
    fun `selectTask loads normalized task relationships`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2))
        val relationship = TaskRelationship(
            id = "relationship-1",
            sourceTaskId = "1",
            targetTaskId = "2",
            type = "depends_on",
            label = "Finish first",
            createdBy = "user",
            createdAt = "2026-08-31T00:00:00Z",
            updatedAt = "2026-08-31T00:00:00Z",
        )
        coEvery { relationshipRepository.listForTask("1") } returns
            ApiResult.Success(listOf(relationship))

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.selectTask(sampleTodo)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(listOf(relationship), viewModel.uiState.value.relationships)
        assertEquals(false, viewModel.uiState.value.isLoadingRelationships)
        assertNull(viewModel.uiState.value.relationshipError)
        coVerify(exactly = 1) { relationshipRepository.listForTask("1") }
    }

    @Test
    fun `relationship titles resolve tasks outside the current filtered page`() = runTest {
        coEvery { todoRepository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = listOf(sampleTodo), total = 1))
        val relationship = TaskRelationship(
            id = "relationship-remote",
            sourceTaskId = "1",
            targetTaskId = "remote-task",
            type = "depends_on",
            createdBy = "user",
            createdAt = "2026-08-31T00:00:00Z",
            updatedAt = "2026-08-31T00:00:00Z",
        )
        coEvery { relationshipRepository.listForTask("1") } returns
            ApiResult.Success(listOf(relationship))
        coEvery { todoRepository.getTodo("remote-task") } returns ApiResult.Success(
            Todo(id = "remote-task", title = "Remote prerequisite"),
        )

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()
        viewModel.selectTask(sampleTodo)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(
            "Remote prerequisite",
            viewModel.uiState.value.relationshipTaskTitles["remote-task"],
        )
        coVerify(exactly = 1) { todoRepository.getTodo("remote-task") }
    }

    @Test
    fun `todo realtime event refreshes selected task and its relationships`() = runTest {
        val updatedTodo = sampleTodo.copy(title = "Updated task")
        val firstRelationship = TaskRelationship(
            id = "relationship-1",
            sourceTaskId = "1",
            targetTaskId = "2",
            type = "related",
            createdBy = "user",
            createdAt = "2026-08-31T00:00:00Z",
            updatedAt = "2026-08-31T00:00:00Z",
        )
        val secondRelationship = firstRelationship.copy(id = "relationship-2", type = "depends_on")
        coEvery { todoRepository.listTodos(any()) } returnsMany listOf(
            ApiResult.Success(PaginatedResponse(items = sampleTodos, total = 2)),
            ApiResult.Success(PaginatedResponse(items = listOf(updatedTodo, sampleTodos[1]), total = 2)),
        )
        coEvery { todoRepository.getTodo("1") } returns ApiResult.Success(updatedTodo)
        coEvery { relationshipRepository.listForTask("1") } returnsMany listOf(
            ApiResult.Success(listOf(firstRelationship)),
            ApiResult.Success(listOf(secondRelationship)),
        )

        viewModel = createViewModel()
        testDispatcher.scheduler.advanceUntilIdle()
        viewModel.selectTask(sampleTodo)
        testDispatcher.scheduler.advanceUntilIdle()

        todoChanged.emit(Unit)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals("Updated task", viewModel.uiState.value.selectedTask?.title)
        assertEquals(listOf(secondRelationship), viewModel.uiState.value.relationships)
        coVerify(exactly = 2) { relationshipRepository.listForTask("1") }
    }
}
