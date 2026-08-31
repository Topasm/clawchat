package com.clawchat.android.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.AgentRun
import com.clawchat.android.core.data.model.AgentRunEvent
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewItem
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ReviewInboxUiState(
    val items: List<ReviewItem> = emptyList(),
    val selected: ReviewItem? = null,
    val selectedRun: AgentRun? = null,
    val selectedRunEvents: List<AgentRunEvent> = emptyList(),
    val note: String = "",
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isDetailLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val detailError: String? = null,
    val error: String? = null,
    val notice: String? = null,
    val followUpRunId: String? = null,
) {
    /** A decision needs authoritative original, result, and impact data. */
    val canDecideSelected: Boolean
        get() = selected?.supportsDecision == true &&
            selectedRun?.id == selected.subjectId &&
            selectedRun.status == AgentRunStatus.WAITING_REVIEW &&
            selectedRun.instructionSnapshot.isNotBlank() &&
            !selectedRun.result.isNullOrBlank() &&
            selected.agentRunApprovalImpact != null &&
            !isLoading &&
            !isRefreshing &&
            !isDetailLoading &&
            detailError == null
}

sealed interface ReviewInboxAction {
    data object Refresh : ReviewInboxAction
    data class Select(val reviewId: String) : ReviewInboxAction
    data object ReloadDetail : ReviewInboxAction
    data object CloseDetail : ReviewInboxAction
    data class UpdateNote(val value: String) : ReviewInboxAction
    data class Decide(val decision: ReviewDecision) : ReviewInboxAction
    data object DismissFeedback : ReviewInboxAction
}

@HiltViewModel
class ReviewInboxViewModel @Inject constructor(
    private val repository: ReviewRepository,
    private val agentRunRepository: AgentRunRepository,
    private val syncManager: SyncManager,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ReviewInboxUiState())
    val uiState: StateFlow<ReviewInboxUiState> = _uiState.asStateFlow()

    private var listGeneration = 0L
    private var detailGeneration = 0L
    private var decisionGeneration = 0L
    private var refreshAfterDecision = false

    init {
        load(isRefresh = false)
        viewModelScope.launch {
            syncManager.reviewChanged.collect {
                if (_uiState.value.isSubmitting) {
                    refreshAfterDecision = true
                } else {
                    load(isRefresh = false, silent = true)
                }
            }
        }
        viewModelScope.launch {
            syncManager.runChanged.collect {
                if (!_uiState.value.isSubmitting) refreshSelectedRun(showLoading = false)
            }
        }
    }

    fun onAction(action: ReviewInboxAction) {
        when (action) {
            ReviewInboxAction.Refresh -> load(isRefresh = true)
            is ReviewInboxAction.Select -> select(action.reviewId)
            ReviewInboxAction.ReloadDetail -> refreshSelectedRun(showLoading = true)
            ReviewInboxAction.CloseDetail -> closeDetail()
            is ReviewInboxAction.UpdateNote -> _uiState.update {
                it.copy(note = action.value.take(MAX_NOTE_LENGTH))
            }
            is ReviewInboxAction.Decide -> submitDecision(action.decision)
            ReviewInboxAction.DismissFeedback -> _uiState.update {
                it.copy(error = null, notice = null, followUpRunId = null)
            }
        }
    }

    fun refresh() = onAction(ReviewInboxAction.Refresh)

    private fun load(isRefresh: Boolean, silent: Boolean = false) {
        val generation = ++listGeneration
        _uiState.update {
            it.copy(
                isLoading = !isRefresh && it.items.isEmpty(),
                isRefreshing = (isRefresh || silent) && it.items.isNotEmpty(),
                error = if (silent) it.error else null,
            )
        }
        viewModelScope.launch {
            when (val result = repository.listPending()) {
                is ApiResult.Success -> {
                    if (generation != listGeneration || _uiState.value.isSubmitting) return@launch
                    var selectionRemoved = false
                    _uiState.update { state ->
                        val selected = state.selected?.let { current ->
                            result.data.firstOrNull { it.id == current.id }.also {
                                selectionRemoved = it == null
                            }
                        }
                        state.copy(
                            items = result.data,
                            selected = selected,
                            selectedRun = if (selected == null) null else state.selectedRun,
                            selectedRunEvents = if (selected == null) emptyList() else state.selectedRunEvents,
                            note = if (selected == null) "" else state.note,
                            isLoading = false,
                            isRefreshing = false,
                            isDetailLoading = if (selected == null) false else state.isDetailLoading,
                            detailError = if (selected == null) null else state.detailError,
                        )
                    }
                    if (selectionRemoved) detailGeneration++
                }
                is ApiResult.Error -> {
                    if (generation != listGeneration) return@launch
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            error = if (silent && it.items.isNotEmpty()) it.error else result.message,
                        )
                    }
                }
                ApiResult.Loading -> Unit
            }
        }
    }

    private fun select(reviewId: String) {
        if (_uiState.value.isSubmitting) return
        val item = _uiState.value.items.firstOrNull { it.id == reviewId } ?: return
        detailGeneration++
        _uiState.update {
            it.copy(
                selected = item,
                selectedRun = null,
                selectedRunEvents = emptyList(),
                note = item.reviewNote.orEmpty(),
                isDetailLoading = item.supportsDecision,
                detailError = null,
                error = null,
                notice = null,
            )
        }
        if (item.supportsDecision) refreshSelectedRun(showLoading = true)
    }

    private fun refreshSelectedRun(showLoading: Boolean) {
        val item = _uiState.value.selected?.takeIf { it.supportsDecision } ?: return
        val generation = ++detailGeneration
        _uiState.update {
            it.copy(
                // A silent websocket refresh may keep showing the previous
                // evidence, but decisions stay locked until it is current.
                isDetailLoading = true,
                detailError = if (showLoading) null else it.detailError,
            )
        }
        viewModelScope.launch {
            val runResult = agentRunRepository.getRun(item.subjectId)
            if (!isCurrentDetail(generation, item)) return@launch
            when (runResult) {
                is ApiResult.Success -> _uiState.update {
                    it.copy(selectedRun = runResult.data, detailError = null)
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(isDetailLoading = false, detailError = runResult.message)
                    }
                    return@launch
                }
                ApiResult.Loading -> return@launch
            }

            val eventResult = agentRunRepository.listEvents(item.subjectId)
            if (!isCurrentDetail(generation, item)) return@launch
            _uiState.update {
                when (eventResult) {
                    is ApiResult.Success -> it.copy(
                        selectedRunEvents = eventResult.data,
                        isDetailLoading = false,
                        detailError = null,
                    )
                    is ApiResult.Error -> it.copy(
                        isDetailLoading = false,
                        detailError = eventResult.message,
                    )
                    ApiResult.Loading -> it.copy(isDetailLoading = false)
                }
            }
        }
    }

    private fun isCurrentDetail(generation: Long, item: ReviewItem): Boolean =
        generation == detailGeneration &&
            _uiState.value.selected?.id == item.id &&
            _uiState.value.selected?.subjectId == item.subjectId &&
            !_uiState.value.isSubmitting

    private fun closeDetail() {
        if (_uiState.value.isSubmitting) return
        detailGeneration++
        _uiState.update {
            it.copy(
                selected = null,
                selectedRun = null,
                selectedRunEvents = emptyList(),
                note = "",
                isDetailLoading = false,
                detailError = null,
                error = null,
            )
        }
    }

    private fun submitDecision(decision: ReviewDecision) {
        val state = _uiState.value
        val item = state.selected ?: return
        if (state.isSubmitting) return
        if (!state.canDecideSelected) {
            _uiState.update {
                it.copy(
                    error = if (!item.supportsDecision) {
                        "This review is read-only on Android until its complete source is available."
                    } else {
                        "Load the authoritative run result and impact before deciding."
                    },
                )
            }
            return
        }

        val generation = ++decisionGeneration
        // A list response started before this decision must not resurrect the item.
        listGeneration++
        detailGeneration++
        val note = state.note.trim().ifEmpty { null }
        _uiState.update { it.copy(isSubmitting = true, error = null, notice = null) }
        viewModelScope.launch {
            when (val result = repository.decide(item.id, decision, note)) {
                is ApiResult.Success -> {
                    if (!isCurrentDecision(generation, item.id)) return@launch
                    _uiState.update { current ->
                        current.copy(
                            items = current.items.filterNot { it.id == item.id },
                            selected = null,
                            selectedRun = null,
                            selectedRunEvents = emptyList(),
                            note = "",
                            isDetailLoading = false,
                            isSubmitting = false,
                            detailError = null,
                            notice = decision.confirmationMessage,
                            followUpRunId = if (decision == ReviewDecision.CHANGES_REQUESTED) {
                                item.subjectId
                            } else {
                                null
                            },
                        )
                    }
                    refreshAfterDecisionIfNeeded()
                }
                is ApiResult.Error -> {
                    if (!isCurrentDecision(generation, item.id)) return@launch
                    _uiState.update { it.copy(isSubmitting = false, error = result.message) }
                    refreshAfterDecisionIfNeeded()
                }
                ApiResult.Loading -> Unit
            }
        }
    }

    private fun isCurrentDecision(generation: Long, reviewId: String): Boolean =
        generation == decisionGeneration &&
            _uiState.value.isSubmitting &&
            _uiState.value.selected?.id == reviewId

    private fun refreshAfterDecisionIfNeeded() {
        if (refreshAfterDecision) {
            refreshAfterDecision = false
            load(isRefresh = false, silent = true)
        }
    }

    private val ReviewDecision.confirmationMessage: String
        get() = when (this) {
            ReviewDecision.APPROVED -> "Review approved"
            ReviewDecision.CHANGES_REQUESTED ->
                "Changes requested. Open the run to send follow-up instructions and resume it."
            ReviewDecision.REJECTED -> "Review rejected"
        }

    private companion object {
        const val MAX_NOTE_LENGTH = 10_000
    }
}
