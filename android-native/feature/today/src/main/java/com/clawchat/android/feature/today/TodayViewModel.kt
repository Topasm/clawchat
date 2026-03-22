package com.clawchat.android.feature.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TodayUiState(
    val greeting: String = "",
    val todayTodos: List<Todo> = emptyList(),
    val overdueTodos: List<Todo> = emptyList(),
    val todayEvents: List<Event> = emptyList(),
    val inboxCount: Int = 0,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class TodayViewModel @Inject constructor(
    private val api: ClawChatApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TodayUiState())
    val uiState: StateFlow<TodayUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, error = null) }
            try {
                val today = api.getToday()
                _uiState.update {
                    it.copy(
                        greeting = today.greeting,
                        todayTodos = today.todayTodos,
                        overdueTodos = today.overdueTodos,
                        todayEvents = today.todayEvents,
                        inboxCount = today.inboxCount,
                        isRefreshing = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isRefreshing = false, error = e.message) }
            }
        }
    }

    fun toggleComplete(todoId: String) {
        viewModelScope.launch {
            val allTodos = _uiState.value.todayTodos + _uiState.value.overdueTodos
            val todo = allTodos.find { it.id == todoId } ?: return@launch
            val newStatus = if (todo.status == "completed") "pending" else "completed"

            // Optimistic update
            _uiState.update { state ->
                state.copy(
                    todayTodos = state.todayTodos.map {
                        if (it.id == todoId) it.copy(status = newStatus) else it
                    },
                    overdueTodos = state.overdueTodos.map {
                        if (it.id == todoId) it.copy(status = newStatus) else it
                    },
                )
            }

            try {
                api.updateTodo(todoId, TodoUpdate(status = newStatus))
            } catch (_: Exception) {
                // Rollback on failure
                _uiState.update { state ->
                    state.copy(
                        todayTodos = state.todayTodos.map {
                            if (it.id == todoId) it.copy(status = todo.status) else it
                        },
                        overdueTodos = state.overdueTodos.map {
                            if (it.id == todoId) it.copy(status = todo.status) else it
                        },
                    )
                }
            }
        }
    }

    fun quickAdd(title: String) {
        if (title.isBlank()) return
        viewModelScope.launch {
            try {
                api.createTodo(TodoCreate(title = title))
                refresh()
            } catch (_: Exception) {
                // Silently fail — user can retry
            }
        }
    }
}
