package com.clawchat.android.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.InboxRouting
import com.clawchat.android.core.data.model.ProjectFolderCandidate
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.InboxRoutingRepository
import com.clawchat.android.core.data.repository.InboxSnapshot
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The Inbox as two lists: what it just filed by itself, each with an undo, and
 * the captures it was not sure about, each with two choices.
 */
data class InboxUiState(
    val snapshot: InboxSnapshot = InboxSnapshot(),
    /** Captures picked with a long press, to file several at once. */
    val selected: Set<String> = emptySet(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    /** A move is on its way; every move button waits for it. */
    val busy: Boolean = false,
    val error: String? = null,
    /** Deleted here but maybe still in a list loaded before the delete. */
    val deleting: Set<String> = emptySet(),
) {
    val routings: List<InboxRouting> get() = snapshot.routings
    val captures: List<Todo> get() = snapshot.captures.filterNot { it.id in deleting }
    /** Selected captures that can still be filed; one the classifier is reading cannot. */
    val selection: List<String> get() = captures.filter { it.id in selected && !it.isOrganizing }.map { it.id }
    val isEmpty: Boolean get() = routings.isEmpty() && captures.isEmpty()
}

/** The classifier or planner is still reading this capture. */
val Todo.isOrganizing: Boolean get() = inboxState == "classifying" || inboxState == "planning"

sealed interface InboxAction {
    data object Refresh : InboxAction
    data class Undo(val routingId: String) : InboxAction
    /** A filed task becomes a note, or a filed note a task. */
    data class SwitchKind(val routing: InboxRouting) : InboxAction
    data class MoveToProject(val routing: InboxRouting, val projectId: String) : InboxAction
    data class FileAsTask(val todoId: String) : InboxAction
    data class FileAsNote(val todoId: String) : InboxAction
    data class ToggleSelected(val todoId: String) : InboxAction
    data object SelectAll : InboxAction
    data object ClearSelection : InboxAction
    data class FileSelection(val asTask: Boolean) : InboxAction
    data class Import(val candidate: ProjectFolderCandidate) : InboxAction
    data class Delete(val todoId: String) : InboxAction
}

@HiltViewModel
class InboxViewModel @Inject constructor(
    private val repository: InboxRoutingRepository,
    private val todoRepository: TodoRepository,
    private val syncManager: SyncManager,
    sessions: SessionStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(InboxUiState())
    val uiState: StateFlow<InboxUiState> = _uiState.asStateFlow()
    private var workspace: String? = null
    private var generation = 0L
    private var loadJob: Job? = null

    init {
        viewModelScope.launch {
            sessions.runtimeState.map { it.workspaceKey }.distinctUntilChanged().collect { key ->
                generation++
                workspace = key
                _uiState.value = InboxUiState(isLoading = key != null)
                load()
            }
        }
        viewModelScope.launch { syncManager.todoChanged.collect { load() } }
    }

    fun onAction(action: InboxAction) {
        when (action) {
            is InboxAction.Refresh -> {
                _uiState.update { it.copy(isRefreshing = true) }
                load()
            }
            is InboxAction.Undo -> move { repository.undo(it, action.routingId) }
            is InboxAction.SwitchKind -> switchKind(action.routing)
            is InboxAction.MoveToProject -> moveToProject(action.routing, action.projectId)
            is InboxAction.FileAsTask -> move { repository.fileAsTask(it, action.todoId) }
            is InboxAction.FileAsNote -> move { repository.toNote(it, action.todoId) }
            is InboxAction.ToggleSelected -> _uiState.update {
                it.copy(selected = if (action.todoId in it.selected) it.selected - action.todoId else it.selected + action.todoId)
            }
            is InboxAction.SelectAll -> _uiState.update { state ->
                state.copy(selected = state.captures.filterNot { it.isOrganizing }.map { it.id }.toSet())
            }
            is InboxAction.ClearSelection -> _uiState.update { it.copy(selected = emptySet()) }
            is InboxAction.FileSelection -> fileSelection(action.asTask)
            is InboxAction.Import -> move { repository.importCandidate(it, action.candidate) }
            is InboxAction.Delete -> delete(action.todoId)
        }
    }

    fun refresh() = onAction(InboxAction.Refresh)

    private fun load() {
        val key = workspace ?: return
        val token = generation
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            val result = repository.load(key)
            if (token != generation) return@launch
            _uiState.update { state ->
                when (result) {
                    is ApiResult.Success -> {
                        val ids = result.data.captures.map { it.id }.toSet()
                        state.copy(
                            snapshot = result.data,
                            selected = state.selected.filterTo(mutableSetOf()) { it in ids },
                            isLoading = false,
                            isRefreshing = false,
                        )
                    }
                    is ApiResult.Error -> state.copy(isLoading = false, isRefreshing = false, error = result.message)
                    is ApiResult.Loading -> state
                }
            }
        }
    }

    private fun switchKind(routing: InboxRouting) {
        val noteId = routing.noteId
        val todoId = routing.todoId
        when {
            !routing.isTask && noteId != null -> move { repository.noteToTask(it, noteId) }
            routing.isTask && todoId != null -> move { repository.toNote(it, todoId) }
        }
    }

    private fun moveToProject(routing: InboxRouting, projectId: String) {
        val todoId = routing.todoId
        val noteId = routing.noteId
        when {
            routing.isTask && todoId != null -> {
                if (_uiState.value.snapshot.projectOf[todoId] == projectId) return
                move { repository.placeTask(it, todoId, projectId) }
            }
            !routing.isTask && noteId != null -> move { repository.moveNote(it, noteId, projectId) }
        }
    }

    private fun fileSelection(asTask: Boolean) {
        val ids = _uiState.value.selection
        if (ids.isEmpty()) return
        _uiState.update { it.copy(selected = emptySet()) }
        moves(ids.map { id -> { key: String -> if (asTask) repository.fileAsTask(key, id) else repository.toNote(key, id) } })
    }

    private fun move(call: suspend (String) -> ApiResult<*>) = moves(listOf(call))

    /** Runs [calls] one after another, then reloads both lists once. */
    private fun moves(calls: List<suspend (String) -> ApiResult<*>>) {
        val key = workspace ?: return
        if (_uiState.value.busy) return
        val token = generation
        _uiState.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            var error: String? = null
            for (call in calls) {
                val result = call(key)
                if (token != generation) return@launch
                if (result is ApiResult.Error) error = result.message
            }
            _uiState.update { it.copy(busy = false, error = error) }
            load()
            syncManager.notifyTodoChanged()
        }
    }

    private fun delete(todoId: String) {
        if (todoId in _uiState.value.deleting) return
        _uiState.update {
            it.copy(deleting = it.deleting + todoId, selected = it.selected - todoId, error = null)
        }
        viewModelScope.launch {
            when (val result = todoRepository.deleteTodo(todoId)) {
                is ApiResult.Success -> Unit
                is ApiResult.Error -> {
                    _uiState.update { it.copy(deleting = it.deleting - todoId, error = result.message) }
                    load()
                }
                is ApiResult.Loading -> Unit
            }
        }
    }
}
