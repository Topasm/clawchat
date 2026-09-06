package com.clawchat.android.feature.tasks

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.repository.TaskCommentRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TaskNotesState(
    val comments: List<TaskComment> = emptyList(),
    val draft: String = "",
    val loading: Boolean = false,
    val sending: Boolean = false,
    val loadError: String? = null,
    val sendError: String? = null,
)

/** State is scoped per task; a late reply must never land in the newly selected task. */
@HiltViewModel
class TaskNotesViewModel @Inject constructor(
    private val repository: TaskCommentRepository,
    private val savedState: SavedStateHandle,
) : ViewModel() {
    private val states = MutableStateFlow<Map<String, TaskNotesState>>(emptyMap())
    val notes = states.asStateFlow()
    private fun current(id: String) = states.value[id] ?: TaskNotesState(draft = savedState["note:$id"] ?: "")
    private fun update(id: String, change: (TaskNotesState) -> TaskNotesState) {
        states.update { it + (id to change(current(id))) }
    }

    fun edit(id: String, text: String) {
        if (current(id).sending) return
        savedState["note:$id"] = text
        update(id) { it.copy(draft = text, sendError = null) }
    }

    fun load(id: String) {
        if (current(id).loading || current(id).sending) return
        update(id) { it.copy(loading = true, loadError = null) }
        viewModelScope.launch {
            when (val result = repository.listForTodos(listOf(id))) {
                is ApiResult.Success -> update(id) { it.copy(loading = false,
                    comments = result.data.filter { comment -> comment.todoId == id }.distinctBy { comment -> comment.id }.sortedBy { comment -> comment.createdAt }) }
                is ApiResult.Error -> update(id) { it.copy(loading = false, loadError = result.message) }
                ApiResult.Loading -> update(id) { it.copy(loading = false, loadError = "Request did not complete") }
            }
        }
    }

    fun send(id: String) {
        val before = current(id)
        val content = before.draft.trim()
        if (before.loading || before.sending || content.isEmpty() || content.length > 4000) return
        update(id) { it.copy(sending = true, sendError = null) }
        viewModelScope.launch {
            when (val result = repository.addComment(id, content)) {
                is ApiResult.Success -> {
                    if (result.data.todoId != id) {
                        update(id) { it.copy(sending = false, sendError = "Unexpected task in response") }
                    } else {
                        savedState["note:$id"] = ""
                        update(id) { it.copy(sending = false, draft = "", comments = (it.comments + result.data).distinctBy { comment -> comment.id }) }
                    }
                }
                is ApiResult.Error -> update(id) { it.copy(sending = false, sendError = result.message) }
                ApiResult.Loading -> update(id) { it.copy(sending = false, sendError = "Request did not complete") }
            }
        }
    }
}
