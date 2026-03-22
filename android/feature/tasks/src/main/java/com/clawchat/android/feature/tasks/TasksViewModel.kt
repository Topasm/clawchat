package com.clawchat.android.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
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

data class TasksUiState(
    val tasks: List<Todo> = emptyList(),
    val isLoading: Boolean = false,
    val statusFilter: String? = null, // null = all
    val selectedTask: Todo? = null,
    val error: String? = null,
)

sealed interface TasksAction {
    data class ToggleComplete(val todoId: String) : TasksAction
    data class SetFilter(val status: String?) : TasksAction
    data class SelectTask(val task: Todo?) : TasksAction
    data object Refresh : TasksAction
    data class Create(val title: String) : TasksAction
    data class Update(val id: String, val update: TodoUpdate) : TasksAction
    data class Delete(val id: String) : TasksAction
}

@HiltViewModel
class TasksViewModel @Inject constructor(
    private val todoRepository: TodoRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState.asStateFlow()

    init {
        doLoadTasks()
    }

    fun onAction(action: TasksAction) {
        when (action) {
            is TasksAction.ToggleComplete -> doToggleComplete(action.todoId)
            is TasksAction.SetFilter -> doSetStatusFilter(action.status)
            is TasksAction.SelectTask -> _uiState.update { it.copy(selectedTask = action.task) }
            is TasksAction.Refresh -> doLoadTasks()
            is TasksAction.Create -> doCreateTask(action.title)
            is TasksAction.Update -> doUpdateTask(action.id, action.update)
            is TasksAction.Delete -> doDeleteTask(action.id)
        }
    }

    // Public convenience methods — delegate to onAction for Screen composable compatibility
    fun loadTasks() = onAction(TasksAction.Refresh)
    fun selectTask(task: Todo?) = onAction(TasksAction.SelectTask(task))
    fun toggleComplete(todoId: String) = onAction(TasksAction.ToggleComplete(todoId))
    fun setStatusFilter(status: String?) = onAction(TasksAction.SetFilter(status))
    fun createTask(title: String) = onAction(TasksAction.Create(title))
    fun updateTask(id: String, update: TodoUpdate) = onAction(TasksAction.Update(id, update))
    fun deleteTask(id: String) = onAction(TasksAction.Delete(id))

    private fun doLoadTasks() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val params = mutableMapOf<String, String>("limit" to "200")
            _uiState.value.statusFilter?.let { params["status"] = it }
            when (val result = todoRepository.listTodos(params)) {
                is ApiResult.Success -> _uiState.update { it.copy(tasks = result.data.items, isLoading = false) }
                is ApiResult.Error -> _uiState.update { it.copy(isLoading = false, error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doSetStatusFilter(status: String?) {
        _uiState.update { it.copy(statusFilter = status) }
        doLoadTasks()
    }

    private fun doToggleComplete(todoId: String) {
        viewModelScope.launch {
            val todo = _uiState.value.tasks.find { it.id == todoId } ?: return@launch
            val newStatus = if (todo.status == "completed") "pending" else "completed"

            try {
                _uiState.optimistic(
                    update = { state ->
                        state.copy(tasks = state.tasks.map {
                            if (it.id == todoId) it.copy(status = newStatus) else it
                        })
                    },
                    rollback = { state ->
                        state.copy(tasks = state.tasks.map {
                            if (it.id == todoId) it.copy(status = todo.status) else it
                        })
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

    private fun doCreateTask(title: String) {
        if (title.isBlank()) return
        viewModelScope.launch {
            when (val result = todoRepository.createTodo(TodoCreate(title = title))) {
                is ApiResult.Success -> _uiState.update { it.copy(tasks = listOf(result.data) + it.tasks) }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doUpdateTask(id: String, update: TodoUpdate) {
        viewModelScope.launch {
            when (val result = todoRepository.updateTodo(id, update)) {
                is ApiResult.Success -> _uiState.update { state ->
                    state.copy(
                        tasks = state.tasks.map { if (it.id == id) result.data else it },
                        selectedTask = if (state.selectedTask?.id == id) result.data else state.selectedTask,
                    )
                }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doDeleteTask(id: String) {
        viewModelScope.launch {
            when (val result = todoRepository.deleteTodo(id)) {
                is ApiResult.Success -> _uiState.update { state ->
                    state.copy(
                        tasks = state.tasks.filter { it.id != id },
                        selectedTask = if (state.selectedTask?.id == id) null else state.selectedTask,
                    )
                }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }
}
