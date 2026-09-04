package com.clawchat.android.feature.planner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WeekUiState(
    val range: WeekRange? = null,
    val overdue: List<Todo> = emptyList(),
    val tasksByDate: Map<LocalDate, List<Todo>> = emptyMap(),
    val spans: List<WeekTaskSpan> = emptyList(),
    val isLoading: Boolean = false,
    val isOffline: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class WeekViewModel @Inject constructor(
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
    private val zoneProvider: DeviceZoneProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(WeekUiState())
    val uiState: StateFlow<WeekUiState> = _uiState.asStateFlow()

    private var loadGeneration = 0L

    init {
        viewModelScope.launch {
            syncManager.todoChanged.collect {
                _uiState.value.range?.let { load(it) }
            }
        }
    }

    fun show(range: WeekRange) {
        if (_uiState.value.range == range) return
        load(range)
    }

    fun refresh() {
        _uiState.value.range?.let { load(it) }
    }

    fun toggleComplete(todoId: String) {
        val todo = findTask(todoId) ?: return
        mutate(todoId, TodoUpdate(status = TaskStatus.COMPLETED))
    }

    fun setDueToday(todoId: String) {
        if (findTask(todoId) == null) return
        mutate(todoId, TodoUpdate(dueDate = LocalDate.now().toString()))
    }

    fun deleteTask(todoId: String) {
        if (findTask(todoId) == null) return
        viewModelScope.launch {
            when (val result = todoRepository.deleteTodo(todoId)) {
                is ApiResult.Success -> removeTask(todoId)
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> Unit
            }
        }
    }

    fun createTask(input: TodoCreate) {
        val title = input.title.trim()
        if (title.isEmpty()) return
        val range = _uiState.value.range ?: return
        val body = input.copy(
            title = title,
            description = input.description?.trim()?.takeIf(String::isNotEmpty),
            dueDate = input.dueDate ?: LocalDate.now().toString(),
        )
        viewModelScope.launch {
            when (val result = todoRepository.createTodo(body)) {
                is ApiResult.Success -> applySnapshot(currentTasks() + result.data, range)
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> Unit
            }
        }
    }

    private fun load(range: WeekRange) {
        val generation = ++loadGeneration
        _uiState.update { it.copy(range = range, isLoading = true, error = null) }
        viewModelScope.launch {
            when (val result = loadActiveTasksDueThrough(range.endInclusive)) {
                is ApiResult.Success -> {
                    if (generation != loadGeneration) return@launch
                    applySnapshot(result.data, range)
                }
                is ApiResult.Error -> {
                    if (generation != loadGeneration) return@launch
                    val cached = todoRepository.getCachedTodosFlow().first()
                    val groups = groupWeekTasks(cached, range, zoneProvider.current())
                    if (groups.overdue.isNotEmpty() || groups.byDate.isNotEmpty()) {
                        _uiState.update {
                            it.copy(
                                overdue = groups.overdue,
                                tasksByDate = groups.byDate,
                                spans = groups.spans,
                                isLoading = false,
                                isOffline = true,
                                error = null,
                            )
                        }
                    } else {
                        _uiState.update {
                            it.copy(isLoading = false, isOffline = false, error = result.message)
                        }
                    }
                }
                is ApiResult.Loading -> Unit
            }
        }
    }

    private suspend fun loadActiveTasksDueThrough(endInclusive: LocalDate): ApiResult<List<Todo>> =
        coroutineScope {
            val results = listOf(TaskStatus.PENDING, TaskStatus.IN_PROGRESS).map { status ->
                async { loadStatusPages(status, endInclusive) }
            }.awaitAll()
            results.filterIsInstance<ApiResult.Error>().firstOrNull()?.let { return@coroutineScope it }
            if (results.any { it is ApiResult.Loading }) return@coroutineScope ApiResult.Loading
            ApiResult.Success(
                results.flatMap { result ->
                    when (result) {
                        is ApiResult.Success -> result.data
                        else -> emptyList()
                    }
                }
                    .distinctBy(Todo::id),
            )
        }

    private suspend fun loadStatusPages(
        status: TaskStatus,
        endInclusive: LocalDate,
    ): ApiResult<List<Todo>> {
        val collected = mutableListOf<Todo>()
        var page = 1
        while (page <= MAX_PAGES) {
            val result = todoRepository.listTodos(
                mapOf(
                    "status" to status.wireValue,
                    "due_before" to "${endInclusive}T23:59:59",
                    "order_by" to "due_date",
                    // Newest due dates first guarantees the selected week is not
                    // pushed out by a very large overdue backlog.
                    "order_dir" to "desc",
                    "limit" to PAGE_SIZE.toString(),
                    "page" to page.toString(),
                ),
            )
            when (result) {
                is ApiResult.Success -> {
                    collected += result.data.items
                    if (result.data.items.isEmpty() || collected.size >= result.data.total) {
                        return ApiResult.Success(collected)
                    }
                }
                is ApiResult.Error -> return result
                is ApiResult.Loading -> return ApiResult.Loading
            }
            page += 1
        }
        return ApiResult.Success(collected)
    }

    private fun mutate(todoId: String, update: TodoUpdate) {
        viewModelScope.launch {
            when (val result = todoRepository.updateTodo(todoId, update)) {
                is ApiResult.Success -> {
                    val range = _uiState.value.range ?: return@launch
                    applySnapshot(currentTasks().filterNot { it.id == todoId } + result.data, range)
                }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> Unit
            }
        }
    }

    private fun applySnapshot(tasks: List<Todo>, range: WeekRange) {
        val groups = groupWeekTasks(tasks, range, zoneProvider.current())
        _uiState.update {
            it.copy(
                range = range,
                overdue = groups.overdue,
                tasksByDate = groups.byDate,
                spans = groups.spans,
                isLoading = false,
                isOffline = false,
                error = null,
            )
        }
    }

    private fun currentTasks(): List<Todo> =
        _uiState.value.overdue + _uiState.value.tasksByDate.values.flatten()

    private fun findTask(todoId: String): Todo? = currentTasks().firstOrNull { it.id == todoId }

    private fun removeTask(todoId: String) {
        _uiState.update { state ->
            state.copy(
                overdue = state.overdue.filterNot { it.id == todoId },
                tasksByDate = state.tasksByDate.mapValues { (_, tasks) ->
                    tasks.filterNot { it.id == todoId }
                }.filterValues(List<Todo>::isNotEmpty),
                error = null,
            )
        }
    }

    private companion object {
        const val PAGE_SIZE = 200
        const val MAX_PAGES = 25
    }
}
