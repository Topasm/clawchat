package com.clawchat.android.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.Todo
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

@HiltViewModel
class InboxViewModel @Inject constructor(
    private val api: ClawChatApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(InboxUiState())
    val uiState: StateFlow<InboxUiState> = _uiState.asStateFlow()

    init {
        loadInbox()
    }

    fun refresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        loadInbox()
    }

    private fun loadInbox() {
        viewModelScope.launch {
            _uiState.update { it.copy(error = null) }
            try {
                // Fetch all todos and filter for inbox items (inbox_state != "none" and not null)
                val resp = api.listTodos(mapOf("limit" to "200"))
                val inboxItems = resp.items.filter { todo ->
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
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, isRefreshing = false, error = e.message)
                }
            }
        }
    }

    fun organize(todoId: String) {
        viewModelScope.launch {
            try {
                api.organizeTodo(todoId)
                // Move item to planning state optimistically
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
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun retryOrganize(todoId: String) {
        organize(todoId)
    }
}
