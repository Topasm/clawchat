package com.clawchat.android.feature.tasks

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.data.repository.TaskRelationshipRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.util.optimistic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "TasksViewModel"

data class TasksUiState(
    val tasks: List<Todo> = emptyList(),
    val isLoading: Boolean = false,
    val statusFilter: TaskStatus? = null, // null = all
    val selectedTask: Todo? = null,
    val relationships: List<TaskRelationship> = emptyList(),
    val relationshipTaskTitles: Map<String, String> = emptyMap(),
    val isLoadingRelationships: Boolean = false,
    val relationshipError: String? = null,
    val error: String? = null,
)

sealed interface TasksAction {
    data class ToggleComplete(val todoId: String) : TasksAction
    data class SetFilter(val status: TaskStatus?) : TasksAction
    data class SelectTask(val task: Todo?) : TasksAction
    data object Refresh : TasksAction
    data class Create(val input: TodoCreate) : TasksAction
    data class Update(val id: String, val update: TodoUpdate) : TasksAction
    data class Delete(val id: String) : TasksAction
    data class ReorderTasks(val reorderedTasks: List<Todo>) : TasksAction
}

@HiltViewModel
class TasksViewModel @Inject constructor(
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
    private val relationshipRepository: TaskRelationshipRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState.asStateFlow()

    private var taskRequestGeneration = 0L
    private var relationshipRequestGeneration = 0L
    private val relationshipTitleCache = mutableMapOf<String, String>()

    init {
        doLoadTasks()
        viewModelScope.launch {
            syncManager.todoChanged.collect {
                relationshipTitleCache.clear()
                doLoadTasks()
                _uiState.value.selectedTask?.id?.let { selectedId ->
                    doRefreshSelectedTask(selectedId)
                    doLoadRelationships(selectedId)
                }
            }
        }
    }

    fun onAction(action: TasksAction) {
        when (action) {
            is TasksAction.ToggleComplete -> doToggleComplete(action.todoId)
            is TasksAction.SetFilter -> doSetStatusFilter(action.status)
            is TasksAction.SelectTask -> doSelectTask(action.task)
            is TasksAction.Refresh -> doLoadTasks()
            is TasksAction.Create -> doCreateTask(action.input)
            is TasksAction.Update -> doUpdateTask(action.id, action.update)
            is TasksAction.Delete -> doDeleteTask(action.id)
            is TasksAction.ReorderTasks -> doReorderTasks(action.reorderedTasks)
        }
    }

    // Public convenience methods — delegate to onAction for Screen composable compatibility
    fun loadTasks() = onAction(TasksAction.Refresh)
    fun selectTask(task: Todo?) = onAction(TasksAction.SelectTask(task))
    fun toggleComplete(todoId: String) = onAction(TasksAction.ToggleComplete(todoId))
    fun setStatusFilter(status: TaskStatus?) = onAction(TasksAction.SetFilter(status))
    fun createTask(input: TodoCreate) = onAction(TasksAction.Create(input))
    fun updateTask(id: String, update: TodoUpdate) = onAction(TasksAction.Update(id, update))
    fun deleteTask(id: String) = onAction(TasksAction.Delete(id))
    fun setDueToday(id: String) = updateTask(id, TodoUpdate(dueDate = java.time.LocalDate.now().toString()))
    fun reorderTasks(reordered: List<Todo>) = onAction(TasksAction.ReorderTasks(reordered))

    private fun doReorderTasks(reordered: List<Todo>) {
        _uiState.update { it.copy(tasks = reordered) }
        viewModelScope.launch {
            reordered.forEachIndexed { index, todo ->
                todoRepository.updateTodo(todo.id, TodoUpdate(sortOrder = index))
            }
        }
    }

    private fun doLoadTasks() {
        val generation = ++taskRequestGeneration
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val params = mutableMapOf<String, String>("limit" to "200")
            _uiState.value.statusFilter?.let { params["status"] = it.wireValue }
            when (val result = todoRepository.listTodos(params)) {
                is ApiResult.Success -> {
                    if (generation != taskRequestGeneration) return@launch
                    relationshipTitleCache.putAll(result.data.items.associate { it.id to it.title })
                    _uiState.update { state ->
                        state.copy(
                            tasks = result.data.items,
                            selectedTask = state.selectedTask?.let { selected ->
                                result.data.items.firstOrNull { it.id == selected.id } ?: selected
                            },
                            isLoading = false,
                        )
                    }
                }
                is ApiResult.Error -> {
                    if (generation != taskRequestGeneration) return@launch
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doSetStatusFilter(status: TaskStatus?) {
        _uiState.update { it.copy(statusFilter = status) }
        doLoadTasks()
    }

    private fun doSelectTask(task: Todo?) {
        _uiState.update {
            it.copy(
                selectedTask = task,
                relationships = emptyList(),
                relationshipTaskTitles = emptyMap(),
                isLoadingRelationships = task != null,
                relationshipError = null,
            )
        }
        task?.let { doLoadRelationships(it.id) }
    }

    private fun doLoadRelationships(taskId: String) {
        val generation = ++relationshipRequestGeneration
        viewModelScope.launch {
            when (val result = relationshipRepository.listForTask(taskId)) {
                is ApiResult.Success -> _uiState.update { state ->
                    if (state.selectedTask?.id != taskId || generation != relationshipRequestGeneration) {
                        state
                    } else {
                        state.copy(
                            relationships = result.data,
                            isLoadingRelationships = false,
                            relationshipError = null,
                        )
                    }
                }
                is ApiResult.Error -> _uiState.update { state ->
                    if (state.selectedTask?.id != taskId || generation != relationshipRequestGeneration) {
                        state
                    } else {
                        state.copy(
                            isLoadingRelationships = false,
                            relationshipError = result.message,
                        )
                    }
                }
                is ApiResult.Loading -> Unit
            }
            val relationships = _uiState.value.relationships
            if (
                generation == relationshipRequestGeneration &&
                _uiState.value.selectedTask?.id == taskId &&
                relationships.isNotEmpty()
            ) {
                resolveRelationshipTitles(taskId, relationships, generation)
            }
        }
    }

    private suspend fun resolveRelationshipTitles(
        taskId: String,
        relationships: List<TaskRelationship>,
        generation: Long,
    ) = coroutineScope {
        val relatedIds = relationships
            .flatMap { listOf(it.sourceTaskId, it.targetTaskId) }
            .filterNot { it == taskId }
            .distinct()
        val missingIds = relatedIds
            .filterNot(relationshipTitleCache::containsKey)
            .take(MAX_RELATED_TITLE_LOOKUPS)
        val resolved = missingIds.chunked(MAX_CONCURRENT_TITLE_LOOKUPS).flatMap { batch ->
            batch.map { relatedId ->
                async {
                    when (val result = todoRepository.getTodo(relatedId)) {
                        is ApiResult.Success -> relatedId to result.data.title
                        else -> null
                    }
                }
            }.awaitAll().filterNotNull()
        }.toMap()
        relationshipTitleCache.putAll(resolved)
        if (generation == relationshipRequestGeneration && _uiState.value.selectedTask?.id == taskId) {
            _uiState.update {
                it.copy(
                    relationshipTaskTitles = relatedIds.mapNotNull { id ->
                        relationshipTitleCache[id]?.let { title -> id to title }
                    }.toMap(),
                )
            }
        }
    }

    private fun doRefreshSelectedTask(taskId: String) {
        viewModelScope.launch {
            when (val result = todoRepository.getTodo(taskId)) {
                is ApiResult.Success -> _uiState.update { state ->
                    if (state.selectedTask?.id == taskId) {
                        relationshipTitleCache[taskId] = result.data.title
                        state.copy(selectedTask = result.data)
                    } else {
                        state
                    }
                }
                else -> Unit
            }
        }
    }

    private fun doToggleComplete(todoId: String) {
        viewModelScope.launch {
            val todo = _uiState.value.tasks.find { it.id == todoId } ?: return@launch
            val newStatus = if (todo.status == TaskStatus.COMPLETED) {
                TaskStatus.PENDING
            } else {
                TaskStatus.COMPLETED
            }

            try {
                _uiState.optimistic(
                    update = { state ->
                        state.copy(
                            tasks = state.tasks.map {
                                if (it.id == todoId) it.copy(status = newStatus) else it
                            },
                            selectedTask = state.selectedTask?.let {
                                if (it.id == todoId) it.copy(status = newStatus) else it
                            },
                        )
                    },
                    rollback = { state ->
                        state.copy(
                            tasks = state.tasks.map {
                                if (it.id == todoId) it.copy(status = todo.status) else it
                            },
                            selectedTask = state.selectedTask?.let {
                                if (it.id == todoId) it.copy(status = todo.status) else it
                            },
                        )
                    },
                ) {
                    val result = todoRepository.updateTodo(todoId, TodoUpdate(status = newStatus))
                    if (result is ApiResult.Error) throw Exception(result.message)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                Log.w(TAG, "Optimistic update failed", e)
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
            when (val result = todoRepository.createTodo(body)) {
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

    private companion object {
        const val MAX_RELATED_TITLE_LOOKUPS = 50
        const val MAX_CONCURRENT_TITLE_LOOKUPS = 8
    }
}
