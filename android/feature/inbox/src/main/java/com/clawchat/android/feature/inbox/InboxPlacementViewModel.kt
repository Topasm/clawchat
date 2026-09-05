package com.clawchat.android.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.data.repository.InboxPlacementRepository
import com.clawchat.android.core.data.repository.InboxPlacementSnapshot
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PlacementChoice(val projectId: String?, val parentId: String?, val reason: String? = null)
data class InboxPlacementState(
    val server: Boolean = false,
    val snapshot: InboxPlacementSnapshot? = null,
    val choices: Map<String, PlacementChoice> = emptyMap(),
    val deadlines: Map<String, InboxDeadlineSuggestion> = emptyMap(),
    val excludedDeadlines: Set<String> = emptySet(),
    val deferred: Set<String> = emptySet(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val stale: Boolean = false,
    val applied: InboxPlacementResult? = null,
    val page: Int = 1,
    val captureText: String = "",
    val capturing: Boolean = false,
    val captureSaved: Boolean = false,
)

@HiltViewModel
class InboxPlacementViewModel @Inject constructor(
    private val repository: InboxPlacementRepository,
    private val sync: SyncManager,
) : ViewModel() {
    private val state = MutableStateFlow(InboxPlacementState())
    val uiState = state.asStateFlow()
    private var scope: ExpectedSessionScope? = null
    private var generation = 0L
    private var job: Job? = null
    private var refreshPending = false
    private var scopeGeneration = 0L
    private var captureJob: Job? = null
    private var captureOperation: Triple<String, String, String>? = null

    init {
        viewModelScope.launch {
            repository.scopes.collect { next ->
                generation++
                scopeGeneration++
                job?.cancel()
                captureJob?.cancel()
                captureOperation = null
                scope = next
                refreshPending = false
                state.value = InboxPlacementState(server = next != null)
                refresh()
            }
        }
        viewModelScope.launch { sync.todoChanged.collect {
            if (state.value.busy) refreshPending = true else refresh()
        } }
    }

    fun editCapture(text: String) {
        if (!state.value.capturing) state.update { it.copy(captureText = text, captureSaved = false) }
    }

    fun capture() {
        val raw = state.value.captureText.trim()
        if (raw.isEmpty() || state.value.capturing) return
        val owner = scope
        val token = scopeGeneration
        val operation = captureOperation?.takeIf { it.first == raw }
            ?: Triple(raw, java.util.UUID.randomUUID().toString(), java.time.Instant.now().toString()).also { captureOperation = it }
        state.update { it.copy(capturing = true, error = null) }
        captureJob = viewModelScope.launch {
            val result = repository.capture(owner, raw, operation.second, operation.third)
            if (scopeGeneration != token) return@launch
            when (result) {
                is ApiResult.Success -> {
                    captureOperation = null
                    state.update { it.copy(capturing = false, captureText = "", captureSaved = true) }
                    sync.notifyTodoChanged()
                    refresh()
                }
                is ApiResult.Error -> state.update { it.copy(capturing = false, error = result.message) }
                else -> state.update { it.copy(capturing = false) }
            }
        }
    }

    fun refresh() {
        val owner = scope ?: return
        if (state.value.busy) { refreshPending = true; return }
        job?.cancel()
        val token = ++generation
        state.update { it.copy(loading = true, error = null, choices = emptyMap(), deadlines = emptyMap(), stale = false) }
        job = viewModelScope.launch {
            when (val loaded = repository.load(owner, state.value.page)) {
                is ApiResult.Success -> if (token == generation) {
                    val snapshot = loaded.data
                    val manual = snapshot.review.items.filter { item ->
                        val choice = item.choice
                        item.choiceRevision == snapshot.graph.revision && choice != null &&
                            snapshot.tasks.any { it.id == item.taskId } &&
                            (choice.projectId == null || snapshot.projects.any { it.id == choice.projectId })
                    }.associate {
                        val choice = requireNotNull(it.choice)
                        it.taskId to PlacementChoice(choice.projectId, choice.parentId)
                    }
                    state.update { it.copy(snapshot = snapshot, choices = manual,
                        deferred = snapshot.review.items.filter { it.deferred }.map { it.taskId }.toSet(),
                        excludedDeadlines = snapshot.review.items.filter { it.excludeDeadline }.map { it.taskId }.toSet()) }
                    val ids = snapshot.tasks.map { it.id }.filterNot { it in state.value.deferred }
                    if (ids.isNotEmpty()) when (val preview = repository.preview(owner, ids, snapshot.graph.revision)) {
                        is ApiResult.Success -> if (token == generation) {
                            val knownProjects = snapshot.projects.map { it.id }.toSet()
                            val nodes = snapshot.graph.nodes.map { it.id }.toSet()
                            // First stage accepts only existing destinations. Unknown/new parents
                            // remain unassigned for explicit manual selection, never silently relocated.
                            val valid = preview.data.suggestions.filter {
                                it.taskId in ids && it.projectId in knownProjects &&
                                    it.proposedParentKey == null && (it.parentId == null || it.parentId in nodes)
                            }
                            if (preview.data.revision == snapshot.graph.revision) state.update {
                                it.copy(choices = valid.associate { suggestion -> suggestion.taskId to
                                    PlacementChoice(suggestion.projectId, suggestion.parentId, suggestion.reason) } + manual,
                                    deadlines = preview.data.deadlines.filter { deadline ->
                                        deadline.taskId in ids && snapshot.tasks.any { task -> task.id == deadline.taskId && task.dueDate == null }
                                    }.associateBy { deadline -> deadline.taskId })
                            } else state.update { it.copy(stale = true) }
                        }
                        is ApiResult.Error -> if (token == generation) state.update { it.copy(error = preview.message, stale = preview.code == 409) }
                        else -> Unit
                    }
                }
                is ApiResult.Error -> if (token == generation) state.update { it.copy(error = loaded.message, stale = true) }
                else -> Unit
            }
            if (token == generation) state.update { it.copy(loading = false) }
        }
    }

    fun choose(taskId: String, project: ProjectPlan?) {
        if (state.value.busy || state.value.loading || state.value.stale) return
        if (state.value.snapshot?.tasks?.none { it.id == taskId } != false) return
        saveReview(taskId, InboxReviewUpdate(choice = InboxReviewChoice(project?.id, project?.rootTaskId),
            revision = state.value.snapshot!!.graph.revision)) {
            it.copy(choices = it.choices + (taskId to PlacementChoice(project?.id, project?.rootTaskId)))
        }
    }

    fun includeDeadline(taskId: String, include: Boolean) {
        if (state.value.busy || state.value.loading || state.value.stale) return
        saveReview(taskId, InboxReviewUpdate(excludeDeadline = !include)) {
            it.copy(excludedDeadlines = if (include) it.excludedDeadlines - taskId else it.excludedDeadlines + taskId)
        }
    }

    fun defer(taskId: String) {
        if (state.value.busy || state.value.loading) return
        saveReview(taskId, InboxReviewUpdate(deferred = true)) { it.copy(deferred = it.deferred + taskId) }
    }

    fun resumeDeferred() {
        if (state.value.busy || state.value.loading) return
        saveReview(null, InboxReviewUpdate()) { it.copy(deferred = emptySet()) }
    }

    private fun saveReview(taskId: String?, body: InboxReviewUpdate, apply: (InboxPlacementState) -> InboxPlacementState) {
        val owner = scope ?: return
        val token = ++generation
        job?.cancel()
        state.update { it.copy(busy = true, error = null) }
        job = viewModelScope.launch {
            val result = if (taskId == null) repository.resumeReview(owner) else repository.saveReview(owner, taskId, body)
            if (token != generation || owner != scope) return@launch
            job = null
            state.update { it.copy(busy = false) }
            when (result) {
                is ApiResult.Success -> state.update(apply)
                is ApiResult.Error -> state.update { it.copy(error = result.message, stale = true) }
                else -> Unit
            }
            if ((result is ApiResult.Success && taskId == null) || refreshPending) {
                refreshPending = false
                refresh()
            }
        }
    }

    fun changePage(delta: Int) {
        if (state.value.busy || state.value.loading) return
        val last = ((state.value.snapshot?.total ?: 0) + 49) / 50
        val page = (state.value.page + delta).coerceIn(1, last.coerceAtLeast(1))
        state.update { it.copy(page = page) }
        refresh()
    }

    fun approve(taskId: String) {
        val current = state.value
        val owner = scope ?: return
        if (current.busy || current.loading || current.stale || taskId in current.deferred) return
        val snapshot = current.snapshot ?: return
        val destination = current.choices[taskId] ?: return
        if (snapshot.tasks.none { it.id == taskId }) return
        mutate(owner) {
            repository.approve(owner, taskId, InboxPlacementRequest(
                destination.projectId, destination.parentId, "none", snapshot.graph.revision,
                dueDate = current.deadlines[taskId]?.dueDate?.takeUnless { taskId in current.excludedDeadlines },
            ))
        }
    }

    fun undo() {
        val owner = scope ?: return
        val applied = state.value.applied ?: return
        if (state.value.busy) return
        mutate(owner, undo = true) { repository.undo(owner, applied.changeSetId) }
    }

    private fun mutate(owner: ExpectedSessionScope, undo: Boolean = false, action: suspend () -> ApiResult<InboxPlacementResult>) {
        job?.cancel()
        val token = ++generation
        state.update { it.copy(busy = true, loading = false, error = null) }
        job = viewModelScope.launch {
            val result = action()
            if (token != generation || owner != scope) return@launch
            job = null
            state.update { it.copy(busy = false) }
            when (result) {
                is ApiResult.Success -> {
                    state.update { it.copy(applied = if (undo) null else result.data) }
                    sync.notifyTodoChanged()
                    refresh()
                }
                is ApiResult.Error -> state.update { it.copy(error = result.message, stale = true, choices = emptyMap()) }
                else -> Unit
            }
            if (refreshPending) { refreshPending = false; refresh() }
        }
    }
}
