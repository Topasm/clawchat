package com.clawchat.android.feature.runs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class AgentRunFilter { ALL, ACTIVE, ATTENTION, RECENT }

enum class AgentRunOperation { CANCEL, RETRY, RESUME }

data class AgentRunsUiState(
    val runs: List<AgentRun> = emptyList(),
    val filter: AgentRunFilter = AgentRunFilter.ALL,
    val selectedRun: AgentRun? = null,
    val events: List<AgentRunEvent> = emptyList(),
    val followUp: String = "",
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isDetailLoading: Boolean = false,
    val pendingRunId: String? = null,
    val pendingOperation: AgentRunOperation? = null,
    val error: String? = null,
    val notice: String? = null,
    val errorResource: Int? = null,
    val noticeResource: Int? = null,
) {
    val visibleRuns: List<AgentRun>
        get() = when (filter) {
            AgentRunFilter.ALL -> runs
            AgentRunFilter.ACTIVE -> runs.filter { it.status.isActive }
            AgentRunFilter.ATTENTION -> runs.filter { it.status.needsAttention }
            AgentRunFilter.RECENT -> runs.filter { it.status.isTerminal }
        }
    val activeCount: Int get() = runs.count { it.status.isActive }
    val attentionCount: Int get() = runs.count { it.status.needsAttention }
    val failedCount: Int get() = runs.count { it.status == AgentRunStatus.FAILED }
    val hasExecutingRuns: Boolean get() = runs.any { it.status.isExecuting }
}

sealed interface AgentRunsAction {
    data object Refresh : AgentRunsAction
    data object Poll : AgentRunsAction
    data class SetFilter(val filter: AgentRunFilter) : AgentRunsAction
    data class SelectRun(val runId: String) : AgentRunsAction
    data object CloseDetails : AgentRunsAction
    data class FollowUpChanged(val value: String) : AgentRunsAction
    data class Cancel(val runId: String) : AgentRunsAction
    data class Retry(val runId: String) : AgentRunsAction
    data class Resume(val runId: String) : AgentRunsAction
    data object ClearFeedback : AgentRunsAction
}

private enum class ListLoad(val priority: Int) {
    INITIAL(0), POLL(1), INVALIDATION(2), USER(3),
}

@HiltViewModel
class AgentRunsViewModel @Inject constructor(
    private val repository: AgentRunRepository,
    private val syncManager: SyncManager,
) : ViewModel() {
    private val _uiState = MutableStateFlow(AgentRunsUiState())
    val uiState: StateFlow<AgentRunsUiState> = _uiState.asStateFlow()

    private var listJob: Job? = null
    private var queuedListLoad: ListLoad? = null
    private var listGeneration = 0L

    private var detailJob: Job? = null
    private var detailRefreshQueued = false
    private var selectionGeneration = 0L
    /** Keeps an exact deep-link target even when it falls outside the list limit. */
    private var selectedRunId: String? = null

    private var operationGeneration = 0L

    init {
        requestList(ListLoad.INITIAL)
        viewModelScope.launch {
            syncManager.runChanged.collect { requestList(ListLoad.INVALIDATION) }
        }
    }

    fun onAction(action: AgentRunsAction) {
        when (action) {
            AgentRunsAction.Refresh -> requestList(ListLoad.USER)
            AgentRunsAction.Poll -> poll()
            is AgentRunsAction.SetFilter -> _uiState.update { it.copy(filter = action.filter) }
            is AgentRunsAction.SelectRun -> selectRunInternal(action.runId)
            AgentRunsAction.CloseDetails -> closeDetailsInternal()
            is AgentRunsAction.FollowUpChanged -> _uiState.update {
                it.copy(
                    followUp = action.value.take(MAX_FOLLOW_UP_LENGTH),
                    error = null,
                    notice = null,
                    errorResource = null,
                    noticeResource = null,
                )
            }
            is AgentRunsAction.Cancel -> cancelRunInternal(action.runId)
            is AgentRunsAction.Retry -> retryRunInternal(action.runId)
            is AgentRunsAction.Resume -> resumeRunInternal(action.runId)
            AgentRunsAction.ClearFeedback -> _uiState.update {
                it.copy(
                    error = null,
                    notice = null,
                    errorResource = null,
                    noticeResource = null,
                )
            }
        }
    }

    fun refresh() = onAction(AgentRunsAction.Refresh)
    fun poll() {
        val state = _uiState.value
        if (!state.hasExecutingRuns || state.pendingOperation != null) return
        requestList(ListLoad.POLL)
    }
    fun setFilter(filter: AgentRunFilter) = onAction(AgentRunsAction.SetFilter(filter))
    fun selectRun(runId: String) = onAction(AgentRunsAction.SelectRun(runId))
    fun closeDetails() = onAction(AgentRunsAction.CloseDetails)
    fun updateFollowUp(value: String) = onAction(AgentRunsAction.FollowUpChanged(value))
    fun cancelRun(runId: String) = onAction(AgentRunsAction.Cancel(runId))
    fun retryRun(runId: String) = onAction(AgentRunsAction.Retry(runId))
    fun resumeRun(runId: String) = onAction(AgentRunsAction.Resume(runId))

    /** At most one list request runs; bursts collapse to the strongest next load. */
    private fun requestList(kind: ListLoad) {
        if (kind == ListLoad.USER) {
            _uiState.update {
                it.copy(
                    isRefreshing = true,
                    error = null,
                    notice = null,
                    errorResource = null,
                    noticeResource = null,
                )
            }
        }
        if (_uiState.value.pendingOperation != null || listJob?.isActive == true) {
            queuedListLoad = queuedListLoad.merge(kind)
            return
        }

        val generation = ++listGeneration
        listJob = viewModelScope.launch {
            try {
                if (kind == ListLoad.INITIAL) {
                    _uiState.update { it.copy(isLoading = it.runs.isEmpty()) }
                }
                when (val result = repository.listRuns()) {
                    is ApiResult.Success -> {
                        if (generation != listGeneration) return@launch
                        _uiState.update { state ->
                            val selected = state.selectedRun?.id?.let { selectedId ->
                                result.data.firstOrNull { it.id == selectedId } ?: state.selectedRun
                            }
                            state.copy(
                                runs = result.data,
                                selectedRun = selected,
                                isLoading = false,
                                isRefreshing = false,
                            )
                        }
                        if (selectedRunId != null) refreshSelectedDetail(showLoading = false)
                    }
                    is ApiResult.Error -> {
                        if (generation != listGeneration) return@launch
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isRefreshing = false,
                                error = if (kind == ListLoad.POLL && it.runs.isNotEmpty()) {
                                    it.error
                                } else {
                                    result.message
                                },
                            )
                        }
                    }
                    ApiResult.Loading -> Unit
                }
            } finally {
                listJob = null
                drainQueuedListLoad()
            }
        }
    }

    private fun drainQueuedListLoad() {
        if (_uiState.value.pendingOperation != null) return
        val next = queuedListLoad ?: return
        queuedListLoad = null
        requestList(next)
    }

    private fun selectRunInternal(runId: String) {
        if (_uiState.value.pendingOperation != null) return
        val cached = _uiState.value.runs.firstOrNull { it.id == runId }
        selectionGeneration++
        selectedRunId = runId
        detailJob?.cancel()
        detailJob = null
        detailRefreshQueued = false
        _uiState.update {
            it.copy(
                selectedRun = cached,
                events = emptyList(),
                followUp = "",
                isDetailLoading = true,
                error = null,
                notice = null,
                errorResource = null,
                noticeResource = null,
            )
        }
        refreshSelectedDetail(showLoading = true)
    }

    /** Coalesces poll/invalidation detail refreshes, including the event log. */
    private fun refreshSelectedDetail(showLoading: Boolean) {
        val runId = selectedRunId ?: _uiState.value.selectedRun?.id ?: return
        if (detailJob?.isActive == true) {
            detailRefreshQueued = true
            return
        }
        val generation = selectionGeneration
        if (showLoading) _uiState.update { it.copy(isDetailLoading = true) }
        detailJob = viewModelScope.launch {
            try {
                val detail = repository.getRun(runId)
                if (!isCurrentSelection(generation, runId)) return@launch
                when (detail) {
                    is ApiResult.Success -> _uiState.update { state ->
                        state.copy(
                            selectedRun = detail.data,
                            runs = state.runs.replaceOrPrepend(detail.data),
                        )
                    }
                    is ApiResult.Error -> {
                        _uiState.update { it.copy(isDetailLoading = false, error = detail.message) }
                        return@launch
                    }
                    ApiResult.Loading -> return@launch
                }

                val events = repository.listEvents(runId)
                if (!isCurrentSelection(generation, runId)) return@launch
                _uiState.update {
                    when (events) {
                        is ApiResult.Success -> it.copy(
                            events = events.data,
                            isDetailLoading = false,
                        )
                        is ApiResult.Error -> it.copy(
                            isDetailLoading = false,
                            error = events.message,
                        )
                        ApiResult.Loading -> it.copy(isDetailLoading = false)
                    }
                }
            } finally {
                // A cancelled request for a previous selection must not clear
                // or drain the replacement selection's in-flight request.
                if (generation == selectionGeneration && selectedRunId == runId) {
                    detailJob = null
                    if (detailRefreshQueued) {
                        detailRefreshQueued = false
                        refreshSelectedDetail(showLoading = false)
                    }
                }
            }
        }
    }

    private fun isCurrentSelection(generation: Long, runId: String): Boolean =
        generation == selectionGeneration &&
            selectedRunId == runId &&
            _uiState.value.pendingOperation == null

    private fun closeDetailsInternal() {
        if (_uiState.value.pendingOperation != null) return
        selectionGeneration++
        selectedRunId = null
        detailJob?.cancel()
        detailJob = null
        detailRefreshQueued = false
        _uiState.update {
            it.copy(
                selectedRun = null,
                events = emptyList(),
                followUp = "",
                isDetailLoading = false,
                error = null,
                notice = null,
                errorResource = null,
                noticeResource = null,
            )
        }
    }

    private fun cancelRunInternal(runId: String) {
        val run = findRun(runId) ?: return
        if (!run.canCancel || _uiState.value.pendingOperation != null) return
        val generation = beginOperation(runId, AgentRunOperation.CANCEL)
        viewModelScope.launch {
            when (val result = repository.cancelRun(runId)) {
                is ApiResult.Success -> finishOperation(
                    generation,
                    runId,
                    AgentRunOperation.CANCEL,
                    result.data,
                    R.string.runs_cancelled_notice,
                )
                is ApiResult.Error -> failOperation(generation, runId, AgentRunOperation.CANCEL, result.message)
                ApiResult.Loading -> Unit
            }
        }
    }

    private fun retryRunInternal(runId: String) {
        val run = findRun(runId) ?: return
        if (!run.canRetry || _uiState.value.pendingOperation != null) return
        val followUp = _uiState.value.followUp.trim().takeIf(String::isNotEmpty)
        val generation = beginOperation(runId, AgentRunOperation.RETRY)
        viewModelScope.launch {
            when (val result = repository.retryRun(runId, followUp)) {
                is ApiResult.Success -> finishOperation(
                    generation,
                    runId,
                    AgentRunOperation.RETRY,
                    result.data,
                    R.string.runs_retry_started_notice,
                    clearFollowUp = true,
                )
                is ApiResult.Error -> failOperation(generation, runId, AgentRunOperation.RETRY, result.message)
                ApiResult.Loading -> Unit
            }
        }
    }

    private fun resumeRunInternal(runId: String) {
        val run = findRun(runId) ?: return
        if (run.status != AgentRunStatus.WAITING_INPUT || _uiState.value.pendingOperation != null) return
        val followUp = _uiState.value.followUp.trim()
        if (followUp.isEmpty()) {
            _uiState.update {
                it.copy(
                    error = null,
                    errorResource = R.string.runs_follow_up_required,
                )
            }
            return
        }
        val generation = beginOperation(runId, AgentRunOperation.RESUME)
        viewModelScope.launch {
            when (val result = repository.resumeRun(runId, followUp)) {
                is ApiResult.Success -> finishOperation(
                    generation,
                    runId,
                    AgentRunOperation.RESUME,
                    result.data,
                    R.string.runs_resumed_notice,
                    clearFollowUp = true,
                )
                is ApiResult.Error -> failOperation(generation, runId, AgentRunOperation.RESUME, result.message)
                ApiResult.Loading -> Unit
            }
        }
    }

    private fun beginOperation(runId: String, operation: AgentRunOperation): Long {
        val generation = ++operationGeneration
        // In-flight list/detail responses predate the mutation and are stale.
        listGeneration++
        selectionGeneration++
        detailJob?.cancel()
        detailJob = null
        detailRefreshQueued = false
        _uiState.update {
            it.copy(
                pendingRunId = runId,
                pendingOperation = operation,
                error = null,
                notice = null,
                errorResource = null,
                noticeResource = null,
            )
        }
        return generation
    }

    private fun finishOperation(
        generation: Long,
        requestedRunId: String,
        operation: AgentRunOperation,
        updatedRun: AgentRun,
        noticeResource: Int,
        clearFollowUp: Boolean = false,
    ) {
        if (!isCurrentOperation(generation, requestedRunId, operation)) return
        selectionGeneration++
        if (_uiState.value.selectedRun?.id == requestedRunId) {
            // Retry returns a new attempt id; subsequent detail/event loads
            // must follow that authoritative replacement run.
            selectedRunId = updatedRun.id
        }
        _uiState.update { state ->
            state.copy(
                runs = state.runs.replaceOrPrepend(updatedRun),
                selectedRun = if (state.selectedRun?.id == requestedRunId) updatedRun else state.selectedRun,
                events = if (updatedRun.id == requestedRunId) state.events else emptyList(),
                followUp = if (clearFollowUp) "" else state.followUp,
                isDetailLoading = false,
                pendingRunId = null,
                pendingOperation = null,
                error = null,
                notice = null,
                errorResource = null,
                noticeResource = noticeResource,
            )
        }
        refreshSelectedDetail(showLoading = false)
        drainQueuedListLoad()
    }

    private fun failOperation(
        generation: Long,
        runId: String,
        operation: AgentRunOperation,
        message: String,
    ) {
        if (!isCurrentOperation(generation, runId, operation)) return
        _uiState.update {
            it.copy(
                pendingRunId = null,
                pendingOperation = null,
                error = message,
                errorResource = null,
                noticeResource = null,
            )
        }
        drainQueuedListLoad()
    }

    private fun isCurrentOperation(
        generation: Long,
        runId: String,
        operation: AgentRunOperation,
    ): Boolean = generation == operationGeneration &&
        _uiState.value.pendingRunId == runId &&
        _uiState.value.pendingOperation == operation

    private fun findRun(runId: String): AgentRun? =
        _uiState.value.runs.firstOrNull { it.id == runId }
            ?: _uiState.value.selectedRun?.takeIf { it.id == runId }

    private fun ListLoad?.merge(other: ListLoad): ListLoad =
        if (this == null || other.priority > priority) other else this

    private companion object {
        const val MAX_FOLLOW_UP_LENGTH = 10_000
    }
}

private fun List<AgentRun>.replaceOrPrepend(updated: AgentRun): List<AgentRun> {
    val hasRun = any { it.id == updated.id }
    return if (hasRun) {
        map { if (it.id == updated.id) updated else it }
    } else {
        listOf(updated) + this
    }
}
