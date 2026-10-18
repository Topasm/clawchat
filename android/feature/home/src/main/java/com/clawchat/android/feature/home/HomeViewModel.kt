package com.clawchat.android.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.ProjectPlan
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ProjectPlanRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope

/** One project row: its title and how much of it is done. */
data class HomeProject(
    val id: String,
    val title: String,
    val done: Int = 0,
    val total: Int = 0,
) {
    val fraction: Float
        get() = if (total <= 0) 0f else (done.toFloat() / total).coerceIn(0f, 1f)
}

data class HomeUiState(
    /** Captures still in the Inbox. */
    val inboxCount: Int = 0,
    /** Open tasks due today or overdue. */
    val todayCount: Int = 0,
    /** Open tasks, not counting Inbox captures or project roots. */
    val taskCount: Int = 0,
    /** Pending reviews plus runs waiting for an answer: what Progress asks the user to check. */
    val checkCount: Int = 0,
    /** Runs that are queued, starting or running. */
    val runningCount: Int = 0,
    val projects: List<HomeProject> = emptyList(),
    val isConnected: Boolean = false,
    val isLoading: Boolean = true,
    val error: String? = null,
)

/** Reduces the server snapshots to the two numbers and the rings the home list shows. */
internal fun homeCounts(reviews: List<ReviewItem>, runs: List<AgentRun>): Pair<Int, Int> {
    val check = reviews.count { it.status == ReviewStatus.PENDING } +
        runs.count { it.status == AgentRunStatus.WAITING_INPUT }
    val running = runs.count { it.status.isExecuting }
    return check to running
}

/** The three numbers beside Inbox, Today and Tasks; the web sidebar counts the same way. */
internal data class HomeTodoCounts(val inbox: Int, val today: Int, val tasks: Int)

internal fun homeTodoCounts(
    todos: List<Todo>,
    today: LocalDate,
    zone: ZoneId = ZoneId.systemDefault(),
): HomeTodoCounts {
    val open = todos.filter { it.status == TaskStatus.PENDING || it.status == TaskStatus.IN_PROGRESS }
    val (inbox, tasks) = open.partition { it.isInboxCapture }
    val ownTasks = tasks.filter { it.source != PROJECT_ROOT_SOURCE }
    return HomeTodoCounts(
        inbox = inbox.size,
        today = ownTasks.count { task -> task.dueDate?.let { dueLocalDate(it, zone) }?.let { it <= today } == true },
        tasks = ownTasks.size,
    )
}

/** An open todo the server has not placed yet, or one without project, date or parent when it says nothing. */
private val Todo.isInboxCapture: Boolean
    get() = inboxState?.let { it != "none" } ?: (projectId == null && dueDate == null && parentId == null)

/** "2030-03-15" or a timestamp, read as a day where the phone is. */
private fun dueLocalDate(raw: String, zone: ZoneId): LocalDate? =
    runCatching { OffsetDateTime.parse(raw).atZoneSameInstant(zone).toLocalDate() }.getOrNull()
        ?: runCatching { LocalDate.parse(raw.take(10)) }.getOrNull()

/** A project's ring counts its own tasks; the root todo is the project itself and a cancelled task is nobody's work. */
internal fun homeProjects(projects: List<ProjectPlan>, todos: List<Todo>): List<HomeProject> {
    val byProject = todos
        .filter { it.projectId != null && it.source != PROJECT_ROOT_SOURCE && it.status != TaskStatus.CANCELLED }
        .groupBy { it.projectId }
    return projects.map { plan ->
        val tasks = byProject[plan.id].orEmpty()
        HomeProject(
            id = plan.id,
            title = plan.title,
            done = tasks.count { it.status == TaskStatus.COMPLETED },
            total = tasks.size,
        )
    }
}

private const val PROJECT_ROOT_SOURCE = "project_root"

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val reviewRepository: ReviewRepository,
    private val agentRunRepository: AgentRunRepository,
    private val projectPlanRepository: ProjectPlanRepository,
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
    private val sessionStore: SessionStore,
) : ViewModel() {
    private val _uiState = MutableStateFlow(HomeUiState(isConnected = syncManager.isConnected.value))
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()
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
            merge(
                syncManager.todoChanged,
                syncManager.reviewChanged,
                syncManager.runChanged,
            ).collect { load() }
        }
    }

    fun refresh() = load()

    fun createTask(input: TodoCreate) {
        val title = input.title.trim()
        if (title.isBlank()) return
        val body = input.copy(
            title = title,
            description = input.description?.trim()?.takeIf { it.isNotEmpty() },
        )
        viewModelScope.launch {
            when (val result = todoRepository.createTodo(body)) {
                is ApiResult.Success -> _uiState.update { it.copy(error = null) }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                ApiResult.Loading -> Unit
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /** Only a server workspace has reviews, runs and projects; local mode keeps the rows it has. */
    private fun load() {
        if (loadJob?.isActive == true) {
            reloadQueued = true
            return
        }
        loadJob = viewModelScope.launch {
            try {
                if (sessionStore.runtimeState.first().mode != WorkspaceMode.SERVER) {
                    _uiState.update { it.copy(isLoading = false) }
                    return@launch
                }
                val snapshot = supervisorScope {
                    val reviews = async { reviewRepository.listPending() }
                    val runs = async { agentRunRepository.listRuns(limit = 100) }
                    val projects = async { projectPlanRepository.list() }
                    val todos = async { todoRepository.listTodos(mapOf("limit" to "200")) }
                    Snapshot(reviews.await(), runs.await(), projects.await(), todos.await())
                }
                _uiState.update { state ->
                    val reviews = snapshot.reviews.dataOrNull()
                    val runs = snapshot.runs.dataOrNull()
                    val (check, running) = if (reviews != null && runs != null) {
                        homeCounts(reviews, runs)
                    } else {
                        state.checkCount to state.runningCount
                    }
                    val projects = snapshot.projects.dataOrNull()
                    val todos = snapshot.todos.dataOrNull()?.items
                    val todoCounts = todos?.let { homeTodoCounts(it, LocalDate.now()) }
                    state.copy(
                        inboxCount = todoCounts?.inbox ?: state.inboxCount,
                        todayCount = todoCounts?.today ?: state.todayCount,
                        taskCount = todoCounts?.tasks ?: state.taskCount,
                        checkCount = check,
                        runningCount = running,
                        projects = if (projects != null && todos != null) homeProjects(projects, todos) else state.projects,
                        isLoading = false,
                    )
                }
            } finally {
                loadJob = null
                if (reloadQueued) {
                    reloadQueued = false
                    load()
                }
            }
        }
    }

    private class Snapshot(
        val reviews: ApiResult<List<ReviewItem>>,
        val runs: ApiResult<List<AgentRun>>,
        val projects: ApiResult<List<ProjectPlan>>,
        val todos: ApiResult<PaginatedResponse<Todo>>,
    )

    private fun <T> ApiResult<T>.dataOrNull(): T? = (this as? ApiResult.Success)?.data

    companion object {
        /** Rows shown on Home before "See all". */
        const val PROJECT_ROWS = 6
    }
}
