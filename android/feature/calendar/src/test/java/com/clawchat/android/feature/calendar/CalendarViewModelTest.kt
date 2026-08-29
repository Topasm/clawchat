package com.clawchat.android.feature.calendar

import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.repository.EventRepository
import com.clawchat.android.core.data.repository.OccurrenceDeleteMode
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
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
        syncManager = mockk(relaxed = true)
        every { syncManager.eventChanged } returns MutableSharedFlow()
        coEvery { eventRepository.cachedEvents(any(), any()) } returns emptyList()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = CalendarViewModel(eventRepository, syncManager)

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
