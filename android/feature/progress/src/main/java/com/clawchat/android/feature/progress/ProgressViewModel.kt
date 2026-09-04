package com.clawchat.android.feature.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.QuickCaptureParser
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.TaskCommentRepository
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
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
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
    val commentsByTodoId: Map<String, List<TaskComment>> = emptyMap(),
    val isConnected: Boolean = false,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errors: List<String> = emptyList(),
    val pendingSyncCount: Int = 0,
    val hasPendingSyncFailure: Boolean = false,
    val isRetryingPendingSync: Boolean = false,
    val pendingActionId: String? = null,
    val actionError: String? = null,
    val isCapturing: Boolean = false,
    val captureError: String? = null,
    val commentError: String? = null,
    /** Tasks, steps and runs with a work action in flight; their controls are held. */
    val pendingWorkIds: Set<String> = emptySet(),
    val workError: String? = null,
) {
    private val computedNowContent by lazy(LazyThreadSafetyMode.NONE) {
        buildNowContent(tasks, reviews, runs)
    }

    val nowContent: NowContent
        get() = computedNowContent

    val attentionItems: List<NowItem>
        get() = nowContent.attentionItems.take(ATTENTION_LIMIT)

    val processingCount: Int
        get() = nowContent.processingCount

    val executingRuns: List<AgentRun>
        get() = runs.filter { it.status.isExecuting }.sortedByDescending(AgentRun::updatedAt)

    /** This is Todo workflow state, not proof that an agent process is running. */
    val inProgressTasks: List<Todo>
        get() {
            val active = taskCandidates.filter { it.status == TaskStatus.IN_PROGRESS }
            val activeIds = active.map(Todo::id).toSet()
            // A step of a task already shown is part of that card, not a card of its own.
            return active
                .filter { it.parentId == null || it.parentId !in activeIds }
                .sortedWith(compareBy<Todo> { it.sortOrder }.thenByDescending { it.updatedAt })
        }

    /** The steps under a task: its open and finished subtasks, in order. */
    fun stepsFor(taskId: String): List<Todo> = tasks
        .filter { it.parentId == taskId && it.status != TaskStatus.CANCELLED }
        .sortedWith(compareBy<Todo> { it.sortOrder }.thenBy { it.createdAt })

    val attentionCount: Int
        get() = nowContent.attentionItems.size

    val activeCount: Int
        get() = executingRuns.size + inProgressTasks.size

    val hasExecutingRuns: Boolean
        get() = executingRuns.isNotEmpty()

    val hasAnyContent: Boolean
        get() = attentionCount > 0 || activeCount > 0 ||
            processingCount > 0 || pendingSyncCount > 0

    private val taskCandidates: List<Todo>
        get() = tasks.filter { it.inboxState == null || it.inboxState == "none" }

    private companion object {
        const val ATTENTION_LIMIT = 10
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ProgressViewModel @Inject constructor(
    private val agentRunRepository: AgentRunRepository,
    private val reviewRepository: ReviewRepository,
    private val todoRepository: TodoRepository,
    private val taskCommentRepository: TaskCommentRepository,
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
    private val _captureEvents = MutableSharedFlow<Todo>(extraBufferCapacity = 1)
    val captureEvents = _captureEvents.asSharedFlow()

    /** Fired when a task was created straight into "In progress"; clears the field. */
    private val _startEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val startEvents = _startEvents.asSharedFlow()

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

    fun clearActionError() {
        if (_uiState.value.pendingActionId == null) {
            _uiState.update { it.copy(actionError = null) }
        }
    }

    fun captureToInbox(raw: String) {
        if (_uiState.value.isCapturing) return
        val draft = QuickCaptureParser.parse(raw) ?: return
        val request = draft.toTodoCreate(
            source = "android_app",
            idempotencyKey = java.util.UUID.randomUUID().toString(),
        )
        viewModelScope.launch {
            _uiState.update { it.copy(isCapturing = true, captureError = null) }
            when (val result = todoRepository.createTodo(request)) {
                is ApiResult.Success -> _uiState.update { state ->
                    state.copy(
                        tasks = listOf(result.data) + state.tasks.filterNot { it.id == result.data.id },
                        isCapturing = false,
                        captureError = null,
                    )
                }.also { _captureEvents.tryEmit(result.data) }
                is ApiResult.Error -> _uiState.update {
                    it.copy(isCapturing = false, captureError = result.message)
                }
                ApiResult.Loading -> _uiState.update {
                    it.copy(isCapturing = false, captureError = ACTION_INCOMPLETE_ERROR)
                }
            }
        }
    }

    fun undoCapture(captured: Todo) {
        val todoId = captured.id
        viewModelScope.launch {
            when (val result = todoRepository.deleteTodo(todoId)) {
                is ApiResult.Success -> _uiState.update { state ->
                    state.copy(tasks = state.tasks.filterNot { it.id == todoId })
                }
                is ApiResult.Error -> _uiState.update { state ->
                    state.copy(
                        tasks = listOf(captured) + state.tasks.filterNot { it.id == captured.id },
                        captureError = result.message,
                    )
                }
                ApiResult.Loading -> _uiState.update { state ->
                    state.copy(
                        tasks = listOf(captured) + state.tasks.filterNot { it.id == captured.id },
                        captureError = ACTION_INCOMPLETE_ERROR,
                    )
                }
            }
        }
    }

    fun addComment(todoId: String, content: String) {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch {
            when (val result = taskCommentRepository.addComment(todoId, trimmed)) {
                is ApiResult.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            commentsByTodoId = state.commentsByTodoId +
                                (todoId to (state.commentsByTodoId[todoId].orEmpty() + result.data)),
                            commentError = null,
                        )
                    }
                }
                is ApiResult.Error -> _uiState.update { it.copy(commentError = result.message) }
                ApiResult.Loading -> _uiState.update { it.copy(commentError = ACTION_INCOMPLETE_ERROR) }
            }
        }
    }

    fun clearCommentError() {
        _uiState.update { it.copy(commentError = null) }
    }

    /**
     * Create a task and put it straight under "In progress".
     *
     * Capture files things for later; this is for the thing you are doing now.
     * The server creates tasks pending, so the start is a second call -- if
     * that one fails the task still exists, just not started, and says so.
     */
    fun startTaskNow(raw: String) {
        if (_uiState.value.isCapturing) return
        val draft = QuickCaptureParser.parse(raw) ?: return
        val request = draft
            .toTodoCreate(source = "android_app", idempotencyKey = java.util.UUID.randomUUID().toString())
            .copy(inboxState = "none")
        viewModelScope.launch {
            _uiState.update { it.copy(isCapturing = true, captureError = null) }
            val created = when (val result = todoRepository.createTodo(request)) {
                is ApiResult.Success -> result.data
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isCapturing = false, captureError = result.message) }
                    return@launch
                }
                ApiResult.Loading -> {
                    _uiState.update { it.copy(isCapturing = false, captureError = ACTION_INCOMPLETE_ERROR) }
                    return@launch
                }
            }
            val startResult = todoRepository.updateTodo(
                created.id,
                TodoUpdate(status = TaskStatus.IN_PROGRESS),
            )
            _uiState.update { state ->
                val task = (startResult as? ApiResult.Success)?.data ?: created
                state.copy(
                    tasks = listOf(task) + state.tasks.filterNot { it.id == task.id },
                    isCapturing = false,
                    captureError = (startResult as? ApiResult.Error)?.message,
                )
            }
            _startEvents.tryEmit(Unit)
        }
    }

    fun completeTask(todoId: String) = setTaskStatus(todoId, TaskStatus.COMPLETED)

    fun pauseTask(todoId: String) = setTaskStatus(todoId, TaskStatus.PENDING)

    fun setStepDone(stepId: String, done: Boolean) =
        setTaskStatus(stepId, if (done) TaskStatus.COMPLETED else TaskStatus.PENDING)

    fun addStep(parentId: String, title: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty() || parentId in _uiState.value.pendingWorkIds) return
        val request = TodoCreate(
            title = trimmed,
            parentId = parentId,
            source = "android_app",
            inboxState = "none",
            idempotencyKey = java.util.UUID.randomUUID().toString(),
        )
        viewModelScope.launch {
            beginWork(parentId)
            when (val result = todoRepository.createTodo(request)) {
                is ApiResult.Success -> finishWork(parentId) { state ->
                    state.copy(tasks = state.tasks.filterNot { it.id == result.data.id } + result.data)
                }
                is ApiResult.Error -> failWork(parentId, result.message)
                ApiResult.Loading -> failWork(parentId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    fun removeStep(stepId: String) {
        if (stepId in _uiState.value.pendingWorkIds) return
        viewModelScope.launch {
            beginWork(stepId)
            when (val result = todoRepository.deleteTodo(stepId)) {
                is ApiResult.Success -> finishWork(stepId) { state ->
                    state.copy(tasks = state.tasks.filterNot { it.id == stepId })
                }
                is ApiResult.Error -> failWork(stepId, result.message)
                ApiResult.Loading -> failWork(stepId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    fun cancelRun(runId: String) {
        if (runId in _uiState.value.pendingWorkIds) return
        viewModelScope.launch {
            beginWork(runId)
            when (val result = agentRunRepository.cancelRun(runId)) {
                is ApiResult.Success -> finishWork(runId) { state ->
                    state.copy(runs = state.runs.map { if (it.id == runId) result.data else it })
                }
                is ApiResult.Error -> failWork(runId, result.message)
                ApiResult.Loading -> failWork(runId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    fun clearWorkError() {
        _uiState.update { it.copy(workError = null) }
    }

    private fun setTaskStatus(todoId: String, status: TaskStatus) {
        if (todoId in _uiState.value.pendingWorkIds) return
        viewModelScope.launch {
            beginWork(todoId)
            when (val result = todoRepository.updateTodo(todoId, TodoUpdate(status = status))) {
                is ApiResult.Success -> finishWork(todoId) { state ->
                    state.copy(tasks = state.tasks.replaceTodo(result.data))
                }
                is ApiResult.Error -> failWork(todoId, result.message)
                ApiResult.Loading -> failWork(todoId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    private fun beginWork(id: String) {
        _uiState.update { it.copy(pendingWorkIds = it.pendingWorkIds + id, workError = null) }
    }

    private fun finishWork(id: String, apply: (ProgressUiState) -> ProgressUiState) {
        _uiState.update { state -> apply(state).copy(pendingWorkIds = state.pendingWorkIds - id) }
    }

    private fun failWork(id: String, message: String) {
        _uiState.update { it.copy(pendingWorkIds = it.pendingWorkIds - id, workError = message) }
    }

    fun fileTodo(item: NowItem, dueToday: Boolean) {
        if (!beginAction(item, NowSource.TODO, NowAction.FILE)) return
        viewModelScope.launch {
            val update = TodoUpdate(
                inboxState = "none",
                dueDate = if (dueToday) java.time.LocalDate.now().toString() else null,
            )
            when (val result = todoRepository.updateTodo(item.sourceId, update)) {
                is ApiResult.Success -> _uiState.update { state ->
                    state.copy(
                        tasks = state.tasks.replaceTodo(result.data),
                        pendingActionId = null,
                        actionError = null,
                    )
                }
                is ApiResult.Error -> failAction(item.stableId, result.message)
                ApiResult.Loading -> failAction(item.stableId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    fun retryNowItem(item: NowItem) {
        if (!beginAction(item, item.source, NowAction.RETRY)) return
        viewModelScope.launch {
            when (item.source) {
                NowSource.TODO -> retryTodo(item)
                NowSource.AGENT_RUN -> retryRun(item)
                NowSource.REVIEW -> failAction(item.stableId, ACTION_UNSUPPORTED_ERROR)
            }
        }
    }

    fun answerRun(item: NowItem, answer: String) {
        val normalized = answer.trim()
        if (normalized.isEmpty()) {
            _uiState.update { it.copy(actionError = ACTION_ANSWER_REQUIRED_ERROR) }
            return
        }
        if (!beginAction(item, NowSource.AGENT_RUN, NowAction.ANSWER)) return
        viewModelScope.launch {
            when (val result = agentRunRepository.resumeRun(item.sourceId, normalized)) {
                is ApiResult.Success -> finishRunAction(item.stableId, result.data)
                is ApiResult.Error -> failAction(item.stableId, result.message)
                ApiResult.Loading -> failAction(item.stableId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    fun answerTodoQuestions(item: NowItem, answers: Map<String, String>) {
        if (!beginAction(item, NowSource.TODO, NowAction.ANSWER)) return
        viewModelScope.launch {
            when (val result = todoRepository.answerTodoQuestions(item.sourceId, answers)) {
                is ApiResult.Success -> finishTodoQuestions(item, answers)
                is ApiResult.Error -> failAction(item.stableId, result.message)
                ApiResult.Loading -> failAction(item.stableId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    fun skipTodoQuestions(item: NowItem) {
        if (!beginAction(item, NowSource.TODO, NowAction.ANSWER)) return
        viewModelScope.launch {
            when (val result = todoRepository.skipTodoQuestions(item.sourceId)) {
                is ApiResult.Success -> finishTodoQuestions(item, emptyMap())
                is ApiResult.Error -> failAction(item.stableId, result.message)
                ApiResult.Loading -> failAction(item.stableId, ACTION_INCOMPLETE_ERROR)
            }
        }
    }

    private fun beginAction(item: NowItem, source: NowSource, action: NowAction): Boolean {
        val current = _uiState.value
        val isCurrent = current.attentionItems.any {
            it.stableId == item.stableId && it.source == source && it.action == action
        }
        if (!isCurrent || !item.canHandleOnDevice || current.pendingActionId != null) return false
        _uiState.update { it.copy(pendingActionId = item.stableId, actionError = null) }
        return true
    }

    private suspend fun retryTodo(item: NowItem) {
        when (val result = todoRepository.organizeTodo(item.sourceId)) {
            is ApiResult.Success -> _uiState.update { state ->
                state.copy(
                    tasks = state.tasks.map { todo ->
                        if (todo.id == item.sourceId) {
                            todo.copy(
                                inboxState = "planning",
                                nextAction = "wait",
                                automationError = null,
                            )
                        } else {
                            todo
                        }
                    },
                    pendingActionId = null,
                    actionError = null,
                )
            }
            is ApiResult.Error -> failAction(item.stableId, result.message)
            ApiResult.Loading -> failAction(item.stableId, ACTION_INCOMPLETE_ERROR)
        }
    }

    private suspend fun retryRun(item: NowItem) {
        when (val result = agentRunRepository.retryRun(item.sourceId)) {
            is ApiResult.Success -> finishRunAction(item.stableId, result.data)
            is ApiResult.Error -> failAction(item.stableId, result.message)
            ApiResult.Loading -> failAction(item.stableId, ACTION_INCOMPLETE_ERROR)
        }
    }

    private fun finishRunAction(stableId: String, run: AgentRun) {
        _uiState.update { state ->
            if (state.pendingActionId != stableId) return@update state
            state.copy(
                runs = state.runs.filterNot { it.id == run.id } + run,
                pendingActionId = null,
                actionError = null,
            )
        }
    }

    private fun finishTodoQuestions(item: NowItem, answers: Map<String, String>) {
        _uiState.update { state ->
            if (state.pendingActionId != item.stableId) return@update state
            state.copy(
                tasks = state.tasks.map { todo ->
                    if (todo.id == item.sourceId) {
                        todo.copy(
                            inboxState = "planning",
                            nextAction = "wait",
                            clarificationAnswers = answers.mapValues { it.value.trim() },
                        )
                    } else {
                        todo
                    }
                },
                pendingActionId = null,
                actionError = null,
            )
        }
    }

    private fun failAction(stableId: String, message: String) {
        _uiState.update { state ->
            if (state.pendingActionId != stableId) return@update state
            state.copy(pendingActionId = null, actionError = message)
        }
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

                val tasks = (tasksResult as? ApiResult.Success)?.data?.items
                    ?: _uiState.value.tasks
                val inProgressIds = tasks
                    .filter {
                        it.status == TaskStatus.IN_PROGRESS &&
                            (it.inboxState == null || it.inboxState == "none")
                    }
                    .map(Todo::id)
                val commentsResult = taskCommentRepository.listForTodos(inProgressIds)

                _uiState.update { state ->
                    val errors = buildList {
                        if (runsResult is ApiResult.Error) add(runsResult.message)
                        if (reviewsResult is ApiResult.Error) add(reviewsResult.message)
                        if (tasksResult is ApiResult.Error) add(tasksResult.message)
                        if (commentsResult is ApiResult.Error) add(commentsResult.message)
                    }.distinct()
                    state.copy(
                        runs = (runsResult as? ApiResult.Success)?.data ?: state.runs,
                        reviews = (reviewsResult as? ApiResult.Success)?.data ?: state.reviews,
                        tasks = tasks,
                        commentsByTodoId = (commentsResult as? ApiResult.Success)?.data
                            ?.groupBy(TaskComment::todoId)
                            ?: state.commentsByTodoId,
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

    private fun List<Todo>.replaceTodo(updated: Todo): List<Todo> =
        if (any { it.id == updated.id }) map { if (it.id == updated.id) updated else it }
        else this + updated

    private companion object {
        const val ACTION_INCOMPLETE_ERROR = "Action did not complete"
        const val ACTION_UNSUPPORTED_ERROR = "Open the review before deciding"
        const val ACTION_ANSWER_REQUIRED_ERROR = "An answer is required"
    }
}
