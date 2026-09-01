package com.clawchat.android.feature.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewRiskLevel
import com.clawchat.android.core.data.model.ReviewSubjectType
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.sync.PendingReviewDecisionStore
import com.clawchat.android.core.sync.PendingSyncStatus
import com.clawchat.android.core.sync.PendingTodoSyncCoordinator
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope

/**
 * The mobile progress surface intentionally keeps three independent truths:
 * task workflow state, agent execution state, and human-review state.
 */
data class ProgressUiState(
    val runs: List<AgentRun> = emptyList(),
    val reviews: List<ReviewItem> = emptyList(),
    val tasks: List<Todo> = emptyList(),
    val isConnected: Boolean = false,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errors: List<String> = emptyList(),
    val pendingSyncCount: Int = 0,
    val hasPendingSyncFailure: Boolean = false,
    val isRetryingPendingSync: Boolean = false,
) {
    val pendingReviews: List<ReviewItem>
        get() = reviews.sortedWith(
            compareBy<ReviewItem> { it.riskLevel.attentionOrder }
                .thenByDescending { it.requestedAt },
        )

    /** Waiting-review runs already represented by a ReviewItem are not duplicated. */
    val attentionRuns: List<AgentRun>
        get() {
            val reviewedRunIds = reviews.asSequence()
                .filter { it.subjectType == ReviewSubjectType.AGENT_RUN }
                .map(ReviewItem::subjectId)
                .toSet()
            return runs
                .filter { run ->
                    (run.status == AgentRunStatus.WAITING_INPUT ||
                        run.status == AgentRunStatus.WAITING_REVIEW ||
                        (run.status == AgentRunStatus.FAILED && run.canRetry)) &&
                        (run.status != AgentRunStatus.WAITING_REVIEW || run.id !in reviewedRunIds)
                }
                .sortedByDescending(AgentRun::updatedAt)
                .take(ATTENTION_LIMIT)
        }

    val executingRuns: List<AgentRun>
        get() = runs.filter { it.status.isExecuting }.sortedByDescending(AgentRun::updatedAt)

    /** This is Todo workflow state, not proof that an agent process is running. */
    val inProgressTasks: List<Todo>
        get() = taskCandidates
            .filter { it.status == TaskStatus.IN_PROGRESS }
            .sortedWith(compareBy<Todo> { it.sortOrder }.thenByDescending { it.updatedAt })

    val recentlyCompletedTasks: List<Todo>
        get() = taskCandidates
            .filter { it.status == TaskStatus.COMPLETED }
            .sortedByDescending { it.completedAt ?: it.updatedAt }
            .take(RECENT_LIMIT)

    val recentlyFinishedRuns: List<AgentRun>
        get() = runs
            .filter { it.status.isTerminal && it.id !in attentionRuns.map(AgentRun::id) }
            .sortedByDescending(AgentRun::updatedAt)
            .take(RECENT_LIMIT)

    val attentionCount: Int
        get() = pendingReviews.size + attentionRuns.size

    val activeCount: Int
        get() = executingRuns.size + inProgressTasks.size

    val hasExecutingRuns: Boolean
        get() = executingRuns.isNotEmpty()

    val hasAnyContent: Boolean
        get() = attentionCount > 0 || activeCount > 0 ||
            recentlyCompletedTasks.isNotEmpty() || recentlyFinishedRuns.isNotEmpty() ||
            pendingSyncCount > 0

    private val taskCandidates: List<Todo>
        get() = tasks.filter { it.inboxState == null || it.inboxState == "none" }

    private companion object {
        const val RECENT_LIMIT = 5
        const val ATTENTION_LIMIT = 10
    }
}

private val ReviewRiskLevel.attentionOrder: Int
    get() = when (this) {
        ReviewRiskLevel.HIGH -> 0
        ReviewRiskLevel.MEDIUM -> 1
        ReviewRiskLevel.LOW -> 2
    }

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ProgressViewModel @Inject constructor(
    private val agentRunRepository: AgentRunRepository,
    private val reviewRepository: ReviewRepository,
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
    private val sessionStore: SessionStore,
    private val pendingTodos: PendingTodoUpdateStore,
    private val pendingReviews: PendingReviewDecisionStore,
    private val pendingSyncCoordinator: PendingTodoSyncCoordinator,
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        ProgressUiState(isConnected = syncManager.isConnected.value),
    )
    val uiState: StateFlow<ProgressUiState> = _uiState.asStateFlow()

    private var loadJob: Job? = null
    private var reloadQueued = false

    init {
        load()
        viewModelScope.launch {
            syncManager.isConnected.collect { connected ->
                _uiState.update { it.copy(isConnected = connected) }
            }
        }
        viewModelScope.launch {
            sessionStore.runtimeState
                .flatMapLatest { runtime ->
                    val key = runtime.workspaceKey?.takeIf(String::isNotBlank)
                        ?: return@flatMapLatest flowOf(PendingSyncStatus())
                    combine(
                        pendingTodos.observeStatus(key),
                        pendingReviews.observeStatus(key),
                    ) { todoStatus, reviewStatus ->
                        PendingSyncStatus(
                            pendingCount = todoStatus.pendingCount + reviewStatus.pendingCount,
                            hasFailure = todoStatus.hasFailure || reviewStatus.hasFailure,
                        )
                    }
                }
                .collect { status ->
                    _uiState.update {
                        it.copy(
                            pendingSyncCount = status.pendingCount,
                            hasPendingSyncFailure = status.hasFailure,
                        )
                    }
                }
        }
        viewModelScope.launch {
            merge(
                syncManager.todoChanged,
                syncManager.reviewChanged,
                syncManager.runChanged,
            ).collect { load(silent = true) }
        }
    }

    fun refresh() = load(userInitiated = true)

    fun retryPending() {
        if (_uiState.value.isRetryingPendingSync) return
        viewModelScope.launch {
            _uiState.update { it.copy(isRetryingPendingSync = true) }
            try {
                pendingSyncCoordinator.flush()
            } finally {
                _uiState.update { it.copy(isRetryingPendingSync = false) }
            }
        }
    }

    fun poll() {
        if (_uiState.value.hasExecutingRuns) load(silent = true)
    }

    private fun load(userInitiated: Boolean = false, silent: Boolean = false) {
        if (loadJob?.isActive == true) {
            reloadQueued = true
            if (userInitiated) _uiState.update { it.copy(isRefreshing = true) }
            return
        }

        _uiState.update {
            it.copy(
                isLoading = !silent && !userInitiated && !it.hasAnyContent,
                isRefreshing = userInitiated,
                errors = if (silent) it.errors else emptyList(),
            )
        }
        loadJob = viewModelScope.launch {
            try {
                val (runsResult, reviewsResult, tasksResult) = supervisorScope {
                    val runs = async { agentRunRepository.listRuns(limit = 100) }
                    val reviews = async { reviewRepository.listPending() }
                    val tasks = async { todoRepository.listTodos(mapOf("limit" to "200")) }
                    Triple(runs.await(), reviews.await(), tasks.await())
                }

                _uiState.update { state ->
                    val errors = buildList {
                        if (runsResult is ApiResult.Error) add(runsResult.message)
                        if (reviewsResult is ApiResult.Error) add(reviewsResult.message)
                        if (tasksResult is ApiResult.Error) add(tasksResult.message)
                    }.distinct()
                    state.copy(
                        runs = (runsResult as? ApiResult.Success)?.data ?: state.runs,
                        reviews = (reviewsResult as? ApiResult.Success)?.data ?: state.reviews,
                        tasks = (tasksResult as? ApiResult.Success)?.data?.items ?: state.tasks,
                        isLoading = false,
                        isRefreshing = false,
                        errors = errors,
                    )
                }
            } finally {
                loadJob = null
                if (reloadQueued) {
                    reloadQueued = false
                    load(silent = true)
                }
            }
        }
    }
}
