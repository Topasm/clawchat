package com.clawchat.android.feature.today

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.util.optimistic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "TodayViewModel"

data class TodayUiState(
    val greeting: String = "",
    val todayTodos: List<Todo> = emptyList(),
    val overdueTodos: List<Todo> = emptyList(),
    val todayEvents: List<Event> = emptyList(),
    val inboxCount: Int = 0,
    val inboxPreview: List<Todo> = emptyList(),
    val briefing: BriefingResponse? = null,
    val isBriefingLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

sealed interface TodayAction {
    data class ToggleComplete(val todoId: String) : TodayAction
    data class Delete(val todoId: String) : TodayAction
    data class SetDueToday(val todoId: String) : TodayAction
    data class Create(val input: TodoCreate) : TodayAction
    data object Refresh : TodayAction
}

@HiltViewModel
class TodayViewModel @Inject constructor(
    private val todayRepository: TodayRepository,
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TodayUiState())
    val uiState: StateFlow<TodayUiState> = _uiState.asStateFlow()

    init {
        doRefresh()
        fetchBriefing()
        viewModelScope.launch { syncManager.todoChanged.collect { doRefresh() } }
        viewModelScope.launch { syncManager.eventChanged.collect { doRefresh() } }
    }

    fun onAction(action: TodayAction) {
        when (action) {
            is TodayAction.ToggleComplete -> doToggleComplete(action.todoId)
            is TodayAction.Delete -> doDelete(action.todoId)
            is TodayAction.SetDueToday -> doSetDueToday(action.todoId)
            is TodayAction.Create -> doCreateTask(action.input)
            is TodayAction.Refresh -> doRefresh()
        }
    }

    // Public convenience methods — delegate to onAction for Screen composable compatibility
    fun refresh() = onAction(TodayAction.Refresh)
    fun toggleComplete(todoId: String) = onAction(TodayAction.ToggleComplete(todoId))
    fun deleteTask(todoId: String) = onAction(TodayAction.Delete(todoId))
    fun setDueToday(todoId: String) = onAction(TodayAction.SetDueToday(todoId))
    fun createTask(input: TodoCreate) = onAction(TodayAction.Create(input))

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
            } catch (e: Exception) {
                Log.w(TAG, "Optimistic update failed", e)
            }
        }
    }

    private fun doDelete(todoId: String) {
        viewModelScope.launch {
            val originalToday = _uiState.value.todayTodos
            val originalOverdue = _uiState.value.overdueTodos
            try {
                _uiState.optimistic(
                    update = { state ->
                        state.copy(
                            todayTodos = state.todayTodos.filter { it.id != todoId },
                            overdueTodos = state.overdueTodos.filter { it.id != todoId },
                        )
                    },
                    rollback = { state ->
                        state.copy(todayTodos = originalToday, overdueTodos = originalOverdue)
                    },
                ) {
                    val result = todoRepository.deleteTodo(todoId)
                    if (result is ApiResult.Error) throw Exception(result.message)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Optimistic update failed", e)
            }
        }
    }

    private fun doSetDueToday(todoId: String) {
        viewModelScope.launch {
            val today = java.time.LocalDate.now().toString()
            val originalState = _uiState.value
            try {
                _uiState.optimistic(
                    update = { state ->
                        val overdueItem = state.overdueTodos.find { it.id == todoId }
                        if (overdueItem != null) {
                            val updated = overdueItem.copy(dueDate = today)
                            state.copy(
                                todayTodos = state.todayTodos + updated,
                                overdueTodos = state.overdueTodos.filter { it.id != todoId },
                            )
                        } else {
                            state.copy(
                                todayTodos = state.todayTodos.map {
                                    if (it.id == todoId) it.copy(dueDate = today) else it
                                },
                            )
                        }
                    },
                    rollback = { _ ->
                        originalState.copy(
                            todayTodos = originalState.todayTodos,
                            overdueTodos = originalState.overdueTodos,
                        )
                    },
                ) {
                    val result = todoRepository.updateTodo(todoId, TodoUpdate(dueDate = today))
                    if (result is ApiResult.Error) throw Exception(result.message)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Optimistic update failed", e)
            }
        }
    }

    private fun fetchBriefing() {
        viewModelScope.launch {
            _uiState.update { it.copy(isBriefingLoading = true) }
            when (val result = todayRepository.getBriefing()) {
                is ApiResult.Success -> _uiState.update {
                    it.copy(briefing = result.data, isBriefingLoading = false)
                }
                is ApiResult.Error -> {
                    Log.w(TAG, "Briefing fetch failed: ${result.message}")
                    _uiState.update { it.copy(isBriefingLoading = false) }
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doCreateTask(input: TodoCreate) {
        val title = input.title.trim()
        if (title.isBlank()) return

        val body = input.copy(
            title = title,
            description = input.description?.trim()?.takeIf { it.isNotEmpty() },
        )
        viewModelScope.launch {
            when (todoRepository.createTodo(body)) {
                is ApiResult.Success -> doRefresh()
                is ApiResult.Error -> Log.w(TAG, "Quick add failed")
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }
}
