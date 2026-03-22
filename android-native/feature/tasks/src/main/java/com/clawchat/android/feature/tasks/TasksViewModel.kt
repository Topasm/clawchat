package com.clawchat.android.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.api.ClawChatApi
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

data class TasksUiState(
    val tasks: List<Todo> = emptyList(),
    val isLoading: Boolean = false,
    val statusFilter: String? = null, // null = all
    val selectedTask: Todo? = null,
    val error: String? = null,
)

@HiltViewModel
class TasksViewModel @Inject constructor(
    private val api: ClawChatApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState.asStateFlow()

    init {
        loadTasks()
    }

    fun loadTasks() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val params = mutableMapOf<String, String>("limit" to "200")
                _uiState.value.statusFilter?.let { params["status"] = it }
                val resp = api.listTodos(params)
                _uiState.update { it.copy(tasks = resp.items, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    fun setStatusFilter(status: String?) {
        _uiState.update { it.copy(statusFilter = status) }
        loadTasks()
    }

    fun selectTask(task: Todo?) {
        _uiState.update { it.copy(selectedTask = task) }
    }

    fun toggleComplete(todoId: String) {
        viewModelScope.launch {
            val todo = _uiState.value.tasks.find { it.id == todoId } ?: return@launch
            val newStatus = if (todo.status == "completed") "pending" else "completed"

            // Optimistic update
            _uiState.update { state ->
                state.copy(tasks = state.tasks.map {
                    if (it.id == todoId) it.copy(status = newStatus) else it
                })
            }

            try {
                api.updateTodo(todoId, TodoUpdate(status = newStatus))
            } catch (_: Exception) {
                // Rollback
                _uiState.update { state ->
                    state.copy(tasks = state.tasks.map {
                        if (it.id == todoId) it.copy(status = todo.status) else it
                    })
                }
            }
        }
    }

    fun createTask(title: String) {
        if (title.isBlank()) return
        viewModelScope.launch {
            try {
                val created = api.createTodo(TodoCreate(title = title))
                _uiState.update { it.copy(tasks = listOf(created) + it.tasks) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun updateTask(id: String, update: TodoUpdate) {
        viewModelScope.launch {
            try {
                val updated = api.updateTodo(id, update)
                _uiState.update { state ->
                    state.copy(
                        tasks = state.tasks.map { if (it.id == id) updated else it },
                        selectedTask = if (state.selectedTask?.id == id) updated else state.selectedTask,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun deleteTask(id: String) {
        viewModelScope.launch {
            try {
                api.deleteTodo(id)
                _uiState.update { state ->
                    state.copy(
                        tasks = state.tasks.filter { it.id != id },
                        selectedTask = if (state.selectedTask?.id == id) null else state.selectedTask,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
}
