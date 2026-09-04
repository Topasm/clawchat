package com.clawchat.android.feature.planner

import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WeekViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: TodoRepository
    private lateinit var syncManager: SyncManager
    private lateinit var todoChanged: MutableSharedFlow<Unit>
    private lateinit var zoneProvider: DeviceZoneProvider

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repository = mockk()
        syncManager = mockk(relaxed = true)
        todoChanged = MutableSharedFlow(extraBufferCapacity = 1)
        every { syncManager.todoChanged } returns todoChanged
        zoneProvider = mockk()
        every { zoneProvider.current() } returns ZoneId.of("Asia/Seoul")
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `show loads both active statuses and groups the selected week`() = runTest {
        val range = WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6))
        coEvery {
            repository.listTodos(match { it["status"] == TaskStatus.PENDING.wireValue })
        } returns ApiResult.Success(
            PaginatedResponse(
                items = listOf(
                    todo("overdue", "2026-08-30"),
                    todo("monday", "2026-08-31"),
                ),
                total = 2,
            ),
        )
        coEvery {
            repository.listTodos(match { it["status"] == TaskStatus.IN_PROGRESS.wireValue })
        } returns ApiResult.Success(
            PaginatedResponse(
                items = listOf(todo("friday", "2026-09-04", TaskStatus.IN_PROGRESS)),
                total = 1,
            ),
        )

        val viewModel = WeekViewModel(repository, syncManager, zoneProvider)
        viewModel.show(range)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(range, state.range)
        assertEquals(listOf("overdue"), state.overdue.map(Todo::id))
        assertEquals(listOf("monday"), state.tasksByDate[range.start]?.map(Todo::id))
        assertEquals(
            listOf("friday"),
            state.tasksByDate[LocalDate.of(2026, 9, 4)]?.map(Todo::id),
        )
        assertFalse(state.isLoading)
        assertNull(state.error)
        coVerify(exactly = 2) {
            repository.listTodos(match {
                it["due_before"] == "2026-09-06T23:59:59" &&
                    it["order_by"] == "due_date"
            })
        }
    }

    @Test
    fun `loader follows pagination until total is reached`() = runTest {
        val range = WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6))
        coEvery {
            repository.listTodos(match {
                it["status"] == TaskStatus.PENDING.wireValue && it["page"] == "1"
            })
        } returns ApiResult.Success(
            PaginatedResponse(items = listOf(todo("one", "2026-09-01")), total = 2),
        )
        coEvery {
            repository.listTodos(match {
                it["status"] == TaskStatus.PENDING.wireValue && it["page"] == "2"
            })
        } returns ApiResult.Success(
            PaginatedResponse(items = listOf(todo("two", "2026-09-02")), total = 2, page = 2),
        )
        coEvery {
            repository.listTodos(match { it["status"] == TaskStatus.IN_PROGRESS.wireValue })
        } returns ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))

        val viewModel = WeekViewModel(repository, syncManager, zoneProvider)
        viewModel.show(range)
        advanceUntilIdle()

        assertEquals(
            listOf("one", "two"),
            viewModel.uiState.value.tasksByDate.values.flatten().map(Todo::id),
        )
        coVerify(exactly = 1) {
            repository.listTodos(match {
                it["status"] == TaskStatus.PENDING.wireValue && it["page"] == "2"
            })
        }
    }

    @Test
    fun `a realtime task change reloads the visible week`() = runTest {
        coEvery { repository.listTodos(any()) } returns
            ApiResult.Success(PaginatedResponse(items = emptyList(), total = 0))
        val range = WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6))
        val viewModel = WeekViewModel(repository, syncManager, zoneProvider)
        viewModel.show(range)
        advanceUntilIdle()

        todoChanged.emit(Unit)
        advanceUntilIdle()

        coVerify(exactly = 4) { repository.listTodos(any()) }
    }

    @Test
    fun `network failure falls back to cached week tasks`() = runTest {
        coEvery { repository.listTodos(any()) } returns ApiResult.Error("offline")
        every { repository.getCachedTodosFlow() } returns flowOf(
            listOf(todo("cached", "2026-09-02")),
        )
        val range = WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6))
        val viewModel = WeekViewModel(repository, syncManager, zoneProvider)

        viewModel.show(range)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(listOf("cached"), state.tasksByDate.values.flatten().map(Todo::id))
        assertEquals(true, state.isOffline)
        assertNull(state.error)
    }

    private fun todo(
        id: String,
        dueDate: String,
        status: TaskStatus = TaskStatus.PENDING,
    ) = Todo(
        id = id,
        title = id,
        dueDate = dueDate,
        status = status,
        inboxState = "none",
    )
}
