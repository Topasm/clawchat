package com.clawchat.android.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class InboxUiState(
    val planningNow: List<Todo> = emptyList(),
    val reviewSuggestion: List<Todo> = emptyList(),
    val needsOrganizing: List<Todo> = emptyList(),
    val failed: List<Todo> = emptyList(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

sealed interface InboxAction {
    data object Refresh : InboxAction
    data class Organize(val todoId: String) : InboxAction
    data class RetryOrganize(val todoId: String) : InboxAction
}

@HiltViewModel
class InboxViewModel @Inject constructor(
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(InboxUiState())
    val uiState: StateFlow<InboxUiState> = _uiState.asStateFlow()

    init {
        doLoadInbox()
        viewModelScope.launch { syncManager.todoChanged.collect { doLoadInbox() } }
    }

    fun onAction(action: InboxAction) {
        when (action) {
            is InboxAction.Refresh -> doRefresh()
            is InboxAction.Organize -> doOrganize(action.todoId)
            is InboxAction.RetryOrganize -> doOrganize(action.todoId)
        }
    }

    // Public convenience methods — delegate to onAction for Screen composable compatibility
    fun refresh() = onAction(InboxAction.Refresh)
    fun organize(todoId: String) = onAction(InboxAction.Organize(todoId))
    fun retryOrganize(todoId: String) = onAction(InboxAction.RetryOrganize(todoId))

    private fun doRefresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        doLoadInbox()
    }

    private fun doLoadInbox() {
        viewModelScope.launch {
            _uiState.update { it.copy(error = null) }
            when (val result = todoRepository.listTodos(mapOf("limit" to "200"))) {
                is ApiResult.Success -> {
                    val inboxItems = result.data.items.filter { todo ->
                        val state = todo.inboxState
                        state != null && state != "none"
                    }
                    _uiState.update {
                        it.copy(
                            planningNow = inboxItems.filter { todo ->
                                todo.inboxState == "classifying" || todo.inboxState == "planning"
                            },
                            reviewSuggestion = inboxItems.filter { todo ->
                                todo.inboxState == "plan_ready"
                            },
                            needsOrganizing = inboxItems.filter { todo ->
                                todo.inboxState == "captured"
                            },
                            failed = inboxItems.filter { todo ->
                                todo.inboxState == "error"
                            },
                            isLoading = false,
                            isRefreshing = false,
                        )
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(isLoading = false, isRefreshing = false, error = result.message)
                    }
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    private fun doOrganize(todoId: String) {
        viewModelScope.launch {
            when (val result = todoRepository.organizeTodo(todoId)) {
                is ApiResult.Success -> {
                    // Move item to planning state after successful API call
                    _uiState.update { state ->
                        val todo = (state.needsOrganizing + state.reviewSuggestion + state.failed)
                            .find { it.id == todoId }
                        if (todo != null) {
                            state.copy(
                                needsOrganizing = state.needsOrganizing.filter { it.id != todoId },
                                reviewSuggestion = state.reviewSuggestion.filter { it.id != todoId },
                                failed = state.failed.filter { it.id != todoId },
                                planningNow = state.planningNow + todo.copy(inboxState = "planning"),
                            )
                        } else {
                            state
                        }
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(error = result.message) }
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }
}
