package com.clawchat.android.feature.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.util.optimistic
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
    val inboxPreview: List<Todo> = emptyList(),
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

sealed interface TodayAction {
    data class ToggleComplete(val todoId: String) : TodayAction
    data class QuickAdd(val title: String) : TodayAction
    data object Refresh : TodayAction
}

@HiltViewModel
class TodayViewModel @Inject constructor(
    private val todayRepository: TodayRepository,
    private val todoRepository: TodoRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TodayUiState())
    val uiState: StateFlow<TodayUiState> = _uiState.asStateFlow()

    init {
        doRefresh()
    }

    fun onAction(action: TodayAction) {
        when (action) {
            is TodayAction.ToggleComplete -> doToggleComplete(action.todoId)
            is TodayAction.QuickAdd -> doQuickAdd(action.title)
            is TodayAction.Refresh -> doRefresh()
        }
    }

    // Public convenience methods — delegate to onAction for Screen composable compatibility
    fun refresh() = onAction(TodayAction.Refresh)
    fun toggleComplete(todoId: String) = onAction(TodayAction.ToggleComplete(todoId))
    fun quickAdd(title: String) = onAction(TodayAction.QuickAdd(title))

    private fun doRefresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, error = null) }
            when (val todayResult = todayRepository.getToday()) {
                is ApiResult.Success -> {
                    val today = todayResult.data
                    // Fetch inbox preview: items with plan_ready or captured state (up to 3)
                    val inboxPreviewItems = when (val todosResult = todoRepository.listTodos(mapOf("limit" to "200"))) {
                        is ApiResult.Success -> todosResult.data.items
                            .filter { todo ->
                                todo.inboxState == "plan_ready" || todo.inboxState == "captured"
                            }
                            .take(3)
                        else -> emptyList()
                    }
                    _uiState.update {
                        it.copy(
                            greeting = today.greeting,
                            todayTodos = today.todayTodos,
                            overdueTodos = today.overdueTodos,
                            todayEvents = today.todayEvents,
                            inboxCount = today.inboxCount,
                            inboxPreview = inboxPreviewItems,
                            isRefreshing = false,
                        )
                    }
                }
                is ApiResult.Error -> _uiState.update { it.copy(isRefreshing = false, error = todayResult.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doToggleComplete(todoId: String) {
        viewModelScope.launch {
            val allTodos = _uiState.value.todayTodos + _uiState.value.overdueTodos
            val todo = allTodos.find { it.id == todoId } ?: return@launch
            val newStatus = if (todo.status == "completed") "pending" else "completed"

            try {
                _uiState.optimistic(
                    update = { state ->
                        state.copy(
                            todayTodos = state.todayTodos.map {
                                if (it.id == todoId) it.copy(status = newStatus) else it
                            },
                            overdueTodos = state.overdueTodos.map {
                                if (it.id == todoId) it.copy(status = newStatus) else it
                            },
                        )
                    },
                    rollback = { state ->
                        state.copy(
                            todayTodos = state.todayTodos.map {
                                if (it.id == todoId) it.copy(status = todo.status) else it
                            },
                            overdueTodos = state.overdueTodos.map {
                                if (it.id == todoId) it.copy(status = todo.status) else it
                            },
                        )
                    },
                ) {
                    val result = todoRepository.updateTodo(todoId, TodoUpdate(status = newStatus))
                    if (result is ApiResult.Error) throw Exception(result.message)
                }
            } catch (_: Exception) {
                // Rollback already handled by optimistic()
            }
        }
    }

    private fun doQuickAdd(title: String) {
        if (title.isBlank()) return
        viewModelScope.launch {
            when (todoRepository.createTodo(TodoCreate(title = title))) {
                is ApiResult.Success -> doRefresh()
                else -> { /* Silently fail — user can retry */ }
            }
        }
    }
}
