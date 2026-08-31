package com.clawchat.android.feature.calendar

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.EventCreate
import com.clawchat.android.core.data.model.EventUpdate
import com.clawchat.android.core.data.repository.EventRepository
import com.clawchat.android.core.data.repository.OccurrenceDeleteMode
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import javax.inject.Inject

data class CalendarUiState(
    val visibleMonth: YearMonth = YearMonth.now(),
    val selectedDate: LocalDate = LocalDate.now(),
    val eventsByDate: Map<LocalDate, List<Event>> = emptyMap(),
    val isLoading: Boolean = false,
    /** True while the month is the last cached copy rather than live data. */
    val isOffline: Boolean = false,
    val error: String? = null,
) {
    val selectedEvents: List<Event>
        get() = eventsByDate[selectedDate].orEmpty()
}

sealed interface CalendarAction {
    data object ShowPreviousMonth : CalendarAction
    data object ShowNextMonth : CalendarAction
    data object ShowToday : CalendarAction
    data object Refresh : CalendarAction
    data class SelectDate(val date: LocalDate) : CalendarAction
    data class Create(val input: EventCreate) : CalendarAction
    data class Update(val id: String, val input: EventUpdate) : CalendarAction
    data class Delete(val event: Event) : CalendarAction
}

@HiltViewModel
class CalendarViewModel @Inject constructor(
    private val eventRepository: EventRepository,
    private val syncManager: SyncManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CalendarUiState())
    val uiState: StateFlow<CalendarUiState> = _uiState.asStateFlow()
    private var loadJob: Job? = null
    private var loadGeneration = 0L

    init {
        load()
        viewModelScope.launch { syncManager.eventChanged.collect { load() } }
    }

    fun onAction(action: CalendarAction) {
        when (action) {
            CalendarAction.ShowPreviousMonth -> showMonth(_uiState.value.visibleMonth.minusMonths(1))
            CalendarAction.ShowNextMonth -> showMonth(_uiState.value.visibleMonth.plusMonths(1))
            CalendarAction.ShowToday -> {
                val today = LocalDate.now()
                _uiState.update { it.copy(selectedDate = today) }
                showMonth(YearMonth.from(today))
            }
            CalendarAction.Refresh -> load()
            is CalendarAction.SelectDate -> selectDate(action.date)
            is CalendarAction.Create -> mutate { eventRepository.createEvent(action.input) }
            is CalendarAction.Update -> mutate { eventRepository.updateEvent(action.id, action.input) }
            is CalendarAction.Delete -> mutate { deleteEvent(action.event) }
        }
    }

    private fun selectDate(date: LocalDate) {
        val month = YearMonth.from(date)
        _uiState.update { it.copy(selectedDate = date) }
        // Tapping a trailing or leading cell moves to the month that owns it.
        if (month != _uiState.value.visibleMonth) showMonth(month)
    }

    private fun showMonth(month: YearMonth) {
        if (month == _uiState.value.visibleMonth) return
        _uiState.update { it.copy(visibleMonth = month, eventsByDate = emptyMap()) }
        load(month)
    }

    private fun load(month: YearMonth = _uiState.value.visibleMonth) {
        val generation = ++loadGeneration
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val from = month.atDay(1)
            val to = month.atEndOfMonth()
            when (val result = eventRepository.listEvents(from, to)) {
                is ApiResult.Success -> {
                    if (!isCurrentLoad(generation, month)) return@launch
                    _uiState.update {
                        it.copy(
                            eventsByDate = groupByDate(result.data),
                            isLoading = false,
                            isOffline = false,
                            error = null,
                        )
                    }
                }

                is ApiResult.Error -> {
                    // Same trade as Today: a cached month beats an empty one,
                    // minus the repeats the server expands, which are not cached.
                    val cached = eventRepository.cachedEvents(from, to)
                    if (!isCurrentLoad(generation, month)) return@launch
                    _uiState.update {
                        if (cached.isEmpty()) {
                            it.copy(isLoading = false, isOffline = false, error = result.message)
                        } else {
                            it.copy(
                                eventsByDate = groupByDate(cached),
                                isLoading = false,
                                isOffline = true,
                                error = null,
                            )
                        }
                    }
                }

                is ApiResult.Loading -> Unit
            }
        }
    }

    private fun isCurrentLoad(generation: Long, month: YearMonth): Boolean =
        generation == loadGeneration && _uiState.value.visibleMonth == month

    private suspend fun deleteEvent(event: Event): ApiResult<Unit> {
        val occurrenceDate = event.occurrenceDate
        // A repeat has no row of its own; only the series does.
        return if (event.isOccurrence && occurrenceDate != null) {
            eventRepository.deleteOccurrence(
                id = event.recurringEventId ?: event.id,
                occurrenceDate = occurrenceDate,
                mode = OccurrenceDeleteMode.ThisOnly,
            )
        } else {
            eventRepository.deleteEvent(event.id)
        }
    }

    private fun mutate(block: suspend () -> ApiResult<*>) {
        viewModelScope.launch {
            when (val result = block()) {
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                else -> load()
            }
        }
    }

    private fun groupByDate(events: List<Event>): Map<LocalDate, List<Event>> = events
        .mapNotNull { event -> eventDate(event.startTime)?.let { it to event } }
        .groupBy({ it.first }, { it.second })
        .mapValues { (_, dayEvents) -> dayEvents.sortedBy { it.startTime } }
}
