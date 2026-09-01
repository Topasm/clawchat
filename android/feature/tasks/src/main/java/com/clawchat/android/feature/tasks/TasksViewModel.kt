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
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "TasksViewModel"

data class TasksUiState(
    val tasks: List<Todo> = emptyList(),
    val isLoading: Boolean = false,
    val statusFilter: TaskStatus? = TaskStatus.IN_PROGRESS, // null = all
    val selectedTask: Todo? = null,
    val relationships: List<TaskRelationship> = emptyList(),
    val relationshipTaskTitles: Map<String, String> = emptyMap(),
    val isLoadingRelationships: Boolean = false,
    val relationshipError: String? = null,
    val pendingDeletion: PendingTaskDeletion? = null,
    val error: String? = null,
)

data class PendingTaskDeletion(
    val token: Long,
    val task: Todo,
    val originalIndex: Int,
)

sealed interface TasksAction {
    data class ToggleComplete(val todoId: String) : TasksAction
    data class SetFilter(val status: TaskStatus?) : TasksAction
    data class SelectTask(val task: Todo?) : TasksAction
    data class Create(val input: TodoCreate) : TasksAction
    data class Update(val id: String, val update: TodoUpdate) : TasksAction
    data class Delete(val id: String) : TasksAction
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
    private var deletionToken = 0L
    private var deletionCommitJob: Job? = null
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
            is TasksAction.Create -> doCreateTask(action.input)
            is TasksAction.Update -> doUpdateTask(action.id, action.update)
            is TasksAction.Delete -> doDeleteTask(action.id)
        }
    }

    fun selectTask(task: Todo?) = onAction(TasksAction.SelectTask(task))
    fun toggleComplete(todoId: String) = onAction(TasksAction.ToggleComplete(todoId))
    fun setStatusFilter(status: TaskStatus?) = onAction(TasksAction.SetFilter(status))
    fun createTask(input: TodoCreate) = onAction(TasksAction.Create(input))
    fun updateTask(id: String, update: TodoUpdate) = onAction(TasksAction.Update(id, update))
    fun deleteTask(id: String) = onAction(TasksAction.Delete(id))
    fun setDueToday(id: String) = updateTask(id, TodoUpdate(dueDate = java.time.LocalDate.now().toString()))

    private fun doLoadTasks() {
        val generation = ++taskRequestGeneration
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            // Keep one complete snapshot so status pages can switch instantly without a
            // network round trip for every tab click or horizontal swipe.
            val params = mapOf("limit" to "200")
            when (val result = todoRepository.listTodos(params)) {
                is ApiResult.Success -> {
                    if (generation != taskRequestGeneration) return@launch
                    relationshipTitleCache.putAll(result.data.items.associate { it.id to it.title })
                    _uiState.update { state ->
                        val visibleItems = result.data.items.filterNot { task ->
                            task.id == state.pendingDeletion?.task?.id
                        }
                        state.copy(
                            tasks = visibleItems,
                            selectedTask = state.selectedTask?.let { selected ->
                                visibleItems.firstOrNull { it.id == selected.id } ?: selected
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
        if (_uiState.value.statusFilter == status) return
        _uiState.update { it.copy(statusFilter = status) }
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
        val state = _uiState.value
        val originalIndex = state.tasks.indexOfFirst { it.id == id }
        if (originalIndex < 0 || state.pendingDeletion?.task?.id == id) return

        state.pendingDeletion?.let { previous ->
            deletionCommitJob?.cancel()
            deletionCommitJob = null
            persistDeletion(previous)
        }
        val pendingDeletion = PendingTaskDeletion(
            token = ++deletionToken,
            task = state.tasks[originalIndex],
            originalIndex = originalIndex,
        )
        _uiState.update { current ->
            current.copy(
                tasks = current.tasks.filterNot { it.id == id },
                selectedTask = if (current.selectedTask?.id == id) null else current.selectedTask,
                pendingDeletion = pendingDeletion,
            )
        }
        deletionCommitJob = viewModelScope.launch {
            delay(DELETE_UNDO_WINDOW_MS)
            deletionCommitJob = null
            commitDelete(pendingDeletion.token)
        }
    }

    fun undoDelete(token: Long) {
        if (_uiState.value.pendingDeletion?.token != token) return
        deletionCommitJob?.cancel()
        deletionCommitJob = null
        _uiState.update { state ->
            val pending = state.pendingDeletion?.takeIf { it.token == token } ?: return@update state
            state.copy(
                tasks = state.tasks.restore(pending),
                pendingDeletion = null,
            )
        }
    }

    fun commitDelete(token: Long) {
        val pending = _uiState.value.pendingDeletion?.takeIf { it.token == token } ?: return
        deletionCommitJob?.cancel()
        deletionCommitJob = null
        _uiState.update { state ->
            if (state.pendingDeletion?.token == token) state.copy(pendingDeletion = null) else state
        }
        persistDeletion(pending)
    }

    private fun persistDeletion(pending: PendingTaskDeletion) {
        viewModelScope.launch {
            when (val result = todoRepository.deleteTodo(pending.task.id)) {
                is ApiResult.Success -> Unit
                is ApiResult.Error -> _uiState.update { state ->
                    state.copy(
                        tasks = state.tasks.restore(pending),
                        error = result.message,
                    )
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun List<Todo>.restore(pending: PendingTaskDeletion): List<Todo> {
        if (any { it.id == pending.task.id }) return this
        return toMutableList().apply {
            add(pending.originalIndex.coerceIn(0, size), pending.task)
        }
    }

    private companion object {
        const val DELETE_UNDO_WINDOW_MS = 10_000L
        const val MAX_RELATED_TITLE_LOOKUPS = 50
        const val MAX_CONCURRENT_TITLE_LOOKUPS = 8
    }
}
