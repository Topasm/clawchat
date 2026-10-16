package com.clawchat.android.feature.today

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.BriefingResponse
import com.clawchat.android.core.data.model.Event
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.model.TodaySuggestion
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.TodayRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.util.optimistic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlinx.coroutines.delay

private const val TAG = "TodayViewModel"

/** Today in three blocks: what is overdue, what is due today, and the day's events. */
data class TodayUiState(
    val todayTodos: List<Todo> = emptyList(),
    val overdueTodos: List<Todo> = emptyList(),
    val todayEvents: List<Event> = emptyList(),
    /** Agent results waiting for review, folded into one line at the top. */
    val reviewCount: Int = 0,
    /** Agent runs queued or running now. */
    val runCount: Int = 0,
    val briefing: BriefingResponse? = null,
    /** What the calendar suggests, folded into the agent line as "제안 N". */
    val suggestions: List<TodaySuggestion> = emptyList(),
    val isBriefingLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    /** True while the screen is showing the last synced day instead of live data. */
    val isOffline: Boolean = false,
    val error: String? = null,
    val pendingDeletion: TodayPendingDeletion? = null,
)

/** A row swiped away and not yet deleted on the server. */
data class TodayPendingDeletion(val token: Long, val todoId: String)

sealed interface TodayAction {
    data class ToggleComplete(val todoId: String) : TodayAction
    data class Delete(val todoId: String) : TodayAction
    data class SetDueToday(val todoId: String) : TodayAction
    data class Create(val input: TodoCreate) : TodayAction
    /** [answer] is accept, dismiss, or undo. */
    data class AnswerSuggestion(val id: String, val answer: String) : TodayAction
    data object Refresh : TodayAction
}

@HiltViewModel
class TodayViewModel @Inject constructor(
    private val todayRepository: TodayRepository,
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
    private val reviewRepository: ReviewRepository,
    private val agentRunRepository: AgentRunRepository,
    private val sessions: SessionStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TodayUiState())
    val uiState: StateFlow<TodayUiState> = _uiState.asStateFlow()
    private var refreshJob: Job? = null

    init {
        doRefresh()
        fetchBriefing()
        refreshAgentWork()
        fetchSuggestions()
        viewModelScope.launch {
            syncManager.todoChanged.collect {
                doRefresh()
                fetchSuggestions()
            }
        }
        viewModelScope.launch {
            syncManager.eventChanged.collect {
                doRefresh()
                fetchSuggestions()
            }
        }
        viewModelScope.launch { syncManager.reviewChanged.collect { refreshAgentWork() } }
        viewModelScope.launch { syncManager.runChanged.collect { refreshAgentWork() } }
    }

    fun onAction(action: TodayAction) {
        when (action) {
            is TodayAction.ToggleComplete -> doToggleComplete(action.todoId)
            is TodayAction.Delete -> doDelete(action.todoId)
            is TodayAction.SetDueToday -> doSetDueToday(action.todoId)
            is TodayAction.Create -> doCreateTask(action.input)
            is TodayAction.AnswerSuggestion -> doAnswerSuggestion(action.id, action.answer)
            is TodayAction.Refresh -> doRefresh()
        }
    }

    // Public convenience methods — delegate to onAction for Screen composable compatibility
    fun refresh() {
        onAction(TodayAction.Refresh)
        refreshAgentWork()
        fetchSuggestions()
    }
    fun toggleComplete(todoId: String) = onAction(TodayAction.ToggleComplete(todoId))
    fun deleteTask(todoId: String) = onAction(TodayAction.Delete(todoId))
    fun setDueToday(todoId: String) = onAction(TodayAction.SetDueToday(todoId))
    fun createTask(input: TodoCreate) = onAction(TodayAction.Create(input))
    fun answerSuggestion(id: String, answer: String) = onAction(TodayAction.AnswerSuggestion(id, answer))

    private fun doRefresh() {
        // A reconnect emits both todo and event invalidations. Cancel the
        // superseded refresh instead of running duplicate REST/Room reads.
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, error = null) }
            when (val todayResult = todayRepository.getToday()) {
                is ApiResult.Success -> {
                    val today = todayResult.data
                    _uiState.update {
                        it.copy(
                            todayTodos = today.todayTodos.filterNot { todo -> todo.id == it.pendingDeletion?.todoId },
                            overdueTodos = today.overdueTodos.filterNot { todo -> todo.id == it.pendingDeletion?.todoId },
                            todayEvents = today.todayEvents,
                            isRefreshing = false,
                            isOffline = false,
                            error = null,
                        )
                    }
                }
                is ApiResult.Error -> {
                    // An unreachable server is the normal case for a
                    // self-hosted app on the move; fall back to the last day
                    // that synced rather than showing an empty screen.
                    val cached = todayRepository.getCachedToday()
                    _uiState.update {
                        if (cached.isEmpty) {
                            it.copy(isRefreshing = false, isOffline = false, error = todayResult.message)
                        } else {
                            it.copy(
                                todayTodos = cached.todayTodos,
                                overdueTodos = cached.overdueTodos,
                                todayEvents = cached.todayEvents,
                                isRefreshing = false,
                                isOffline = true,
                                error = null,
                            )
                        }
                    }
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doToggleComplete(todoId: String) {
        viewModelScope.launch {
            val allTodos = _uiState.value.todayTodos + _uiState.value.overdueTodos
            val todo = allTodos.find { it.id == todoId } ?: return@launch
            val newStatus = if (todo.status == TaskStatus.COMPLETED) {
                TaskStatus.PENDING
            } else {
                TaskStatus.COMPLETED
            }

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
        _uiState.value.pendingDeletion?.let { commitDelete(it.token) }
        val pending = TodayPendingDeletion(token = ++deletionToken, todoId = todoId)
        _uiState.update { state ->
            state.copy(
                todayTodos = state.todayTodos.filter { it.id != todoId },
                overdueTodos = state.overdueTodos.filter { it.id != todoId },
                pendingDeletion = pending,
            )
        }
        deletionCommitJob = viewModelScope.launch {
            delay(DELETE_UNDO_WINDOW_MS)
            commitDelete(pending.token)
        }
    }

    private var deletionToken = 0L
    private var deletionCommitJob: Job? = null

    /** The row leaves at once; the server call waits for the undo window. */
    fun undoDelete(token: Long) {
        if (_uiState.value.pendingDeletion?.token != token) return
        deletionCommitJob?.cancel()
        deletionCommitJob = null
        _uiState.update { it.copy(pendingDeletion = null) }
        doRefresh()
    }

    fun commitDelete(token: Long) {
        val pending = _uiState.value.pendingDeletion?.takeIf { it.token == token } ?: return
        deletionCommitJob?.cancel()
        deletionCommitJob = null
        _uiState.update { it.copy(pendingDeletion = null) }
        viewModelScope.launch {
            when (val result = todoRepository.deleteTodo(pending.todoId)) {
                is ApiResult.Success -> Unit
                is ApiResult.Error -> {
                    _uiState.update { it.copy(error = result.message) }
                    doRefresh()
                }
                is ApiResult.Loading -> Unit
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
                        val movedItem = state.overdueTodos.find { it.id == todoId }
                        if (movedItem != null) {
                            val updated = movedItem.copy(dueDate = today)
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

    private var suggestionJob: Job? = null

    private fun fetchSuggestions() {
        suggestionJob?.cancel()
        suggestionJob = viewModelScope.launch {
            when (val result = todayRepository.getSuggestions()) {
                is ApiResult.Success -> _uiState.update { it.copy(suggestions = result.data.suggestions) }
                is ApiResult.Error -> Log.w(TAG, "Suggestions fetch failed: ${result.message}")
                is ApiResult.Loading -> Unit
            }
        }
    }

    /** Dismissing hides the row at once; adding or undoing waits for what it made. */
    private fun doAnswerSuggestion(id: String, answer: String) {
        val before = _uiState.value.suggestions
        if (answer == SUGGESTION_DISMISS) {
            _uiState.update { state -> state.copy(suggestions = state.suggestions.filterNot { it.id == id }) }
        }
        viewModelScope.launch {
            when (val result = todayRepository.answerSuggestion(id, answer)) {
                is ApiResult.Success -> {
                    fetchSuggestions()
                    if (answer != SUGGESTION_DISMISS) doRefresh()
                }
                is ApiResult.Error -> {
                    Log.w(TAG, "Answering a suggestion failed: ${result.message}")
                    _uiState.update { it.copy(suggestions = before, error = result.message) }
                }
                is ApiResult.Loading -> Unit
            }
        }
    }

    /** Counts for the one agent line; a device-only workspace has no agents to count. */
    private fun refreshAgentWork() {
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            if (sessions.runtimeState.first().mode != WorkspaceMode.SERVER) return@launch
            val reviews = async { reviewRepository.listPending() }
            val runs = async { agentRunRepository.listRuns(limit = 100) }
            val reviewResult = reviews.await()
            val runResult = runs.await()
            _uiState.update { state ->
                state.copy(
                    reviewCount = (reviewResult as? ApiResult.Success)?.data?.size ?: state.reviewCount,
                    runCount = (runResult as? ApiResult.Success)?.data?.count { it.status.isExecuting } ?: state.runCount,
                )
            }
        }
    }

    private var agentJob: Job? = null

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

private const val DELETE_UNDO_WINDOW_MS = 5_000L

const val SUGGESTION_ACCEPT = "accept"
const val SUGGESTION_DISMISS = "dismiss"
const val SUGGESTION_UNDO = "undo"
