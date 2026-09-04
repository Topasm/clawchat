package com.clawchat.android.feature.calendar

import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.repository.EventRepository
import com.clawchat.android.core.data.repository.OccurrenceDeleteMode
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

@OptIn(ExperimentalCoroutinesApi::class)
class CalendarViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var eventRepository: EventRepository
    private lateinit var todoRepository: TodoRepository
    private lateinit var syncManager: SyncManager

    private val month = YearMonth.now()
    private val firstDay: LocalDate = month.atDay(1)
    private val secondDay: LocalDate = month.atDay(2)

    private fun event(
        id: String,
        date: LocalDate,
        time: String = "09:00:00",
        isOccurrence: Boolean = false,
    ) = Event(
        id = id,
        title = "Event $id",
        startTime = "${date}T$time",
        isOccurrence = isOccurrence,
        occurrenceDate = if (isOccurrence) date.toString() else null,
        recurringEventId = if (isOccurrence) id else null,
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        eventRepository = mockk()
        todoRepository = mockk()
        syncManager = mockk(relaxed = true)
        every { syncManager.eventChanged } returns MutableSharedFlow()
        every { syncManager.todoChanged } returns MutableSharedFlow()
        coEvery { eventRepository.cachedEvents(any(), any()) } returns emptyList()
        coEvery { todoRepository.listTodos(any()) } returns ApiResult.Success(page(emptyList()))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun page(todos: List<Todo>) = PaginatedResponse(
        items = todos,
        total = todos.size,
        page = 1,
        limit = todos.size.coerceAtLeast(1),
    )

    private fun viewModel() = CalendarViewModel(eventRepository, todoRepository, syncManager)

    @Test
    fun `deadlines run from today through the due date`() = runTest {
        val today = LocalDate.now()
        coEvery { eventRepository.listEvents(any(), any()) } returns ApiResult.Success(emptyList())
        coEvery { todoRepository.listTodos(any()) } returns ApiResult.Success(
            page(
                listOf(
                    Todo(
                        id = "todo-1",
                        title = "Ship the release",
                        status = TaskStatus.PENDING,
                        dueDate = "${today.plusDays(2)}T23:59:00",
                    ),
                ),
            ),
        )

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val tasksByDate = viewModel.uiState.value.tasksByDate
        assertEquals(
            setOf(today, today.plusDays(1), today.plusDays(2)),
            tasksByDate.keys,
        )
        assertEquals(
            TaskSegmentPosition.START,
            tasksByDate.getValue(today).single().position,
        )
        assertEquals(
            TaskSegmentPosition.END,
            tasksByDate.getValue(today.plusDays(2)).single().position,
        )
    }

    // Deadlines are a secondary layer: losing them must not blank the month or
    // raise a banner over events that loaded fine.
    @Test
    fun `a failed deadline load leaves the month alone`() = runTest {
        coEvery { eventRepository.listEvents(any(), any()) } returns
            ApiResult.Success(listOf(event("a", firstDay)))
        coEvery { todoRepository.listTodos(any()) } returns ApiResult.Error("offline")

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.tasksByDate.isEmpty())
        assertEquals(setOf(firstDay), state.eventsByDate.keys)
        assertNull(state.error)
    }

    @Test
    fun `creating a task reloads the deadlines`() = runTest {
        coEvery { eventRepository.listEvents(any(), any()) } returns ApiResult.Success(emptyList())
        val created = Todo(id = "todo-1", title = "Ship", status = TaskStatus.PENDING)
        coEvery { todoRepository.createTodo(any(), any()) } returns ApiResult.Success(created)

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()
        viewModel.onAction(CalendarAction.CreateTask(TodoCreate(title = "Ship")))
        dispatcher.scheduler.advanceUntilIdle()

        coVerify { todoRepository.createTodo(any(), any()) }
        // Once at startup, once after the task landed.
        coVerify(atLeast = 2) { todoRepository.listTodos(any()) }
    }

    @Test
    fun `the visible month loads grouped by day`() = runTest {
        coEvery { eventRepository.listEvents(firstDay, month.atEndOfMonth()) } returns
            ApiResult.Success(
                listOf(
                    event("a", firstDay, "09:00:00"),
                    event("b", firstDay, "08:00:00"),
                    event("c", secondDay),
                ),
            )

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(setOf(firstDay, secondDay), state.eventsByDate.keys)
        // Two events on one day stay in start-time order.
        assertEquals(listOf("b", "a"), state.eventsByDate.getValue(firstDay).map { it.id })
        assertEquals(false, state.isLoading)
        assertEquals(false, state.isOffline)
    }

    @Test
    fun `an unreachable server falls back to the cached month`() = runTest {
        coEvery { eventRepository.listEvents(any(), any()) } returns ApiResult.Error("offline")
        coEvery { eventRepository.cachedEvents(firstDay, month.atEndOfMonth()) } returns
            listOf(event("cached", firstDay))

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.isOffline)
        assertEquals(listOf("cached"), state.eventsByDate.getValue(firstDay).map { it.id })
        assertNull(state.error)
    }

    @Test
    fun `an empty cache reports the failure instead`() = runTest {
        coEvery { eventRepository.listEvents(any(), any()) } returns ApiResult.Error("offline")

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals("offline", state.error)
        assertEquals(false, state.isOffline)
        assertTrue(state.eventsByDate.isEmpty())
    }

    @Test
    fun `moving a month loads that month's range`() = runTest {
        coEvery { eventRepository.listEvents(any(), any()) } returns ApiResult.Success(emptyList())

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(CalendarAction.ShowNextMonth)
        dispatcher.scheduler.advanceUntilIdle()

        val next = month.plusMonths(1)
        assertEquals(next, viewModel.uiState.value.visibleMonth)
        coVerify { eventRepository.listEvents(next.atDay(1), next.atEndOfMonth()) }
    }

    @Test
    fun `a late old month response cannot replace the visible month`() = runTest {
        val oldResponse = CompletableDeferred<ApiResult<List<Event>>>()
        val next = month.plusMonths(1)
        val nextEvent = event("next", next.atDay(2))
        coEvery { eventRepository.listEvents(firstDay, month.atEndOfMonth()) } coAnswers {
            // Model an adapter that cannot cancel an already-dispatched call.
            withContext(NonCancellable) { oldResponse.await() }
        }
        coEvery { eventRepository.listEvents(next.atDay(1), next.atEndOfMonth()) } returns
            ApiResult.Success(listOf(nextEvent))

        val viewModel = viewModel()
        runCurrent()
        viewModel.onAction(CalendarAction.ShowNextMonth)
        runCurrent()

        assertEquals(next, viewModel.uiState.value.visibleMonth)
        assertEquals(listOf("next"), viewModel.uiState.value.eventsByDate[next.atDay(2)]?.map { it.id })

        oldResponse.complete(ApiResult.Success(listOf(event("old", firstDay))))
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(next, viewModel.uiState.value.visibleMonth)
        assertEquals(listOf("next"), viewModel.uiState.value.eventsByDate[next.atDay(2)]?.map { it.id })
        assertTrue(firstDay !in viewModel.uiState.value.eventsByDate)
    }

    @Test
    fun `deleting a repeat removes only that occurrence`() = runTest {
        val occurrence = event("series", secondDay, isOccurrence = true)
        coEvery { eventRepository.listEvents(any(), any()) } returns
            ApiResult.Success(listOf(occurrence))
        coEvery {
            eventRepository.deleteOccurrence(any(), any(), any())
        } returns ApiResult.Success(Unit)

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(CalendarAction.Delete(occurrence))
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) {
            eventRepository.deleteOccurrence(
                "series",
                secondDay.toString(),
                OccurrenceDeleteMode.ThisOnly,
            )
        }
        coVerify(exactly = 0) { eventRepository.deleteEvent(any()) }
    }

    @Test
    fun `deleting a stored event removes the event itself`() = runTest {
        val stored = event("single", secondDay)
        coEvery { eventRepository.listEvents(any(), any()) } returns
            ApiResult.Success(listOf(stored))
        coEvery { eventRepository.deleteEvent("single") } returns ApiResult.Success(Unit)

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        viewModel.onAction(CalendarAction.Delete(stored))
        dispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { eventRepository.deleteEvent("single") }
        coVerify(exactly = 0) { eventRepository.deleteOccurrence(any(), any(), any()) }
    }

    @Test
    fun `selecting a day in another month follows it`() = runTest {
        coEvery { eventRepository.listEvents(any(), any()) } returns ApiResult.Success(emptyList())

        val viewModel = viewModel()
        dispatcher.scheduler.advanceUntilIdle()

        val nextMonthDay = month.plusMonths(1).atDay(3)
        viewModel.onAction(CalendarAction.SelectDate(nextMonthDay))
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(nextMonthDay, viewModel.uiState.value.selectedDate)
        assertEquals(YearMonth.from(nextMonthDay), viewModel.uiState.value.visibleMonth)
    }
}
