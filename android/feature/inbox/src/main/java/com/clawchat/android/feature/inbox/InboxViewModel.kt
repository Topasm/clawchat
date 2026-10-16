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
 * the captures it could not file, each with two choices.
 */
data class InboxUiState(
    val snapshot: InboxSnapshot = InboxSnapshot(),
    /** Captures picked with a long press, to file several at once. */
    val selected: Set<String> = emptySet(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    /** Reading the next page of todos while the user scrolls down. */
    val isLoadingMore: Boolean = false,
    /** A move is on its way; every move button waits for it. */
    val busy: Boolean = false,
    val error: String? = null,
    /** Deleted here but maybe still in a list loaded before the delete. */
    val deleting: Set<String> = emptySet(),
    /** The move just made, offered back once in a snackbar. */
    val lastMove: InboxMove? = null,
) {
    val routings: List<InboxRouting> get() = snapshot.routings
    val captures: List<Todo> get() = snapshot.captures.filterNot { it.id in deleting }
    /** Selected captures that can still be filed; one the classifier is reading cannot. */
    val selection: List<String> get() = captures.filter { it.id in selected && !it.isOrganizing }.map { it.id }
    val isEmpty: Boolean get() = routings.isEmpty() && captures.isEmpty()
}

/** What a move did, and how to take it back. */
data class InboxMove(val token: Long, val kind: InboxMoveKind, val count: Int, val undo: List<InboxUndo>)

enum class InboxMoveKind { TASK, NOTE, PROJECT }

sealed interface InboxUndo {
    /** A move between the Inbox, a task and a note: the server keeps its routing. */
    data class Routing(val routingId: String) : InboxUndo
    /** A task placed in a project. */
    data class Placement(val changeSetId: String) : InboxUndo
    /** A note moved to a project, back to where it was. */
    data class NoteProject(val noteId: String, val projectId: String?) : InboxUndo
}

/** The classifier or planner is still reading this capture. */
val Todo.isOrganizing: Boolean get() = inboxState == "classifying" || inboxState == "planning"

sealed interface InboxAction {
    data object Refresh : InboxAction
    data object LoadMore : InboxAction
    data class Undo(val routingId: String) : InboxAction
    /** Take back [InboxUiState.lastMove] from its snackbar. */
    data class UndoMove(val token: Long) : InboxAction
    data class MoveDismissed(val token: Long) : InboxAction
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

private typealias MoveCall = suspend (String) -> ApiResult<InboxUndo?>

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
    private var moveToken = 0L
    /** Projects this screen moved notes into, so an undo can put them back. */
    private val noteProjects = mutableMapOf<String, String?>()

    init {
        viewModelScope.launch {
            sessions.runtimeState.map { it.workspaceKey }.distinctUntilChanged().collect { key ->
                generation++
                workspace = key
                noteProjects.clear()
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
            is InboxAction.LoadMore -> loadMore()
            is InboxAction.Undo -> moves(null) { listOf { key -> repository.undo(key, action.routingId).none() } }
            is InboxAction.UndoMove -> undoMove(action.token)
            is InboxAction.MoveDismissed -> _uiState.update {
                if (it.lastMove?.token == action.token) it.copy(lastMove = null) else it
            }
            is InboxAction.SwitchKind -> switchKind(action.routing)
            is InboxAction.MoveToProject -> moveToProject(action.routing, action.projectId)
            is InboxAction.FileAsTask -> moves(InboxMoveKind.TASK) { listOf(fileCall(action.todoId, asTask = true)) }
            is InboxAction.FileAsNote -> moves(InboxMoveKind.NOTE) { listOf(fileCall(action.todoId, asTask = false)) }
            is InboxAction.ToggleSelected -> _uiState.update {
                it.copy(selected = if (action.todoId in it.selected) it.selected - action.todoId else it.selected + action.todoId)
            }
            is InboxAction.SelectAll -> _uiState.update { state ->
                state.copy(selected = state.captures.filterNot { it.isOrganizing }.map { it.id }.toSet())
            }
            is InboxAction.ClearSelection -> _uiState.update { it.copy(selected = emptySet()) }
            is InboxAction.FileSelection -> fileSelection(action.asTask)
            is InboxAction.Import -> moves(null) { listOf { key -> repository.importCandidate(key, action.candidate).none() } }
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
                            isLoadingMore = false,
                        )
                    }
                    is ApiResult.Error -> state.copy(isLoading = false, isRefreshing = false, error = result.message)
                    is ApiResult.Loading -> state
                }
            }
        }
    }

    private fun loadMore() {
        val key = workspace ?: return
        val state = _uiState.value
        if (!state.snapshot.hasMoreTodos || state.isLoadingMore || loadJob?.isActive == true) return
        val token = generation
        val page = state.snapshot.todoPage + 1
        _uiState.update { it.copy(isLoadingMore = true) }
        loadJob = viewModelScope.launch {
            val result = repository.loadMoreCaptures(key, page)
            if (token != generation) return@launch
            _uiState.update { current ->
                when (result) {
                    is ApiResult.Success -> {
                        val known = current.snapshot.captures.map { it.id }.toSet()
                        current.copy(
                            snapshot = current.snapshot.copy(
                                captures = current.snapshot.captures + result.data.captures.filterNot { it.id in known },
                                projectOf = current.snapshot.projectOf + result.data.projectOf,
                                todoPage = result.data.page,
                                hasMoreTodos = result.data.hasMore,
                            ),
                            isLoadingMore = false,
                        )
                    }
                    is ApiResult.Error -> current.copy(isLoadingMore = false, error = result.message)
                    is ApiResult.Loading -> current
                }
            }
        }
    }

    private fun fileCall(todoId: String, asTask: Boolean): MoveCall = { key ->
        (if (asTask) repository.fileAsTask(key, todoId) else repository.toNote(key, todoId)).routing()
    }

    private fun switchKind(routing: InboxRouting) {
        val noteId = routing.noteId
        val todoId = routing.todoId
        when {
            !routing.isTask && noteId != null ->
                moves(InboxMoveKind.TASK) { listOf { key -> repository.noteToTask(key, noteId).routing() } }
            routing.isTask && todoId != null ->
                moves(InboxMoveKind.NOTE) { listOf { key -> repository.toNote(key, todoId).routing() } }
        }
    }

    private fun moveToProject(routing: InboxRouting, projectId: String) {
        val todoId = routing.todoId
        val noteId = routing.noteId
        when {
            routing.isTask && todoId != null -> {
                if (_uiState.value.snapshot.projectOf[todoId] == projectId) return
                moves(InboxMoveKind.PROJECT) {
                    listOf { key ->
                        when (val placed = repository.placeTask(key, todoId, projectId)) {
                            is ApiResult.Success -> ApiResult.Success(InboxUndo.Placement(placed.data.changeSetId))
                            is ApiResult.Error -> placed
                            is ApiResult.Loading -> placed
                        }
                    }
                }
            }
            !routing.isTask && noteId != null -> {
                val previous = noteProjects[noteId]
                if (previous == projectId) return
                moves(InboxMoveKind.PROJECT) {
                    listOf { key ->
                        when (val moved = repository.moveNote(key, noteId, projectId)) {
                            is ApiResult.Success -> {
                                noteProjects[noteId] = projectId
                                ApiResult.Success(InboxUndo.NoteProject(noteId, previous))
                            }
                            is ApiResult.Error -> moved
                            is ApiResult.Loading -> moved
                        }
                    }
                }
            }
        }
    }

    private fun fileSelection(asTask: Boolean) {
        val ids = _uiState.value.selection
        if (ids.isEmpty()) return
        _uiState.update { it.copy(selected = emptySet()) }
        moves(if (asTask) InboxMoveKind.TASK else InboxMoveKind.NOTE) { ids.map { fileCall(it, asTask) } }
    }

    private fun undoMove(token: Long) {
        val move = _uiState.value.lastMove?.takeIf { it.token == token } ?: return
        _uiState.update { it.copy(lastMove = null) }
        moves(null) {
            // Last move first, so a batch unwinds in the order it was made.
            move.undo.reversed().map { step ->
                { key: String ->
                    when (step) {
                        is InboxUndo.Routing -> repository.undo(key, step.routingId).none()
                        is InboxUndo.Placement -> repository.undoPlacement(key, step.changeSetId).none()
                        is InboxUndo.NoteProject -> repository.moveNote(key, step.noteId, step.projectId).none()
                            .also { if (it is ApiResult.Success) noteProjects[step.noteId] = step.projectId }
                    }
                }
            }
        }
    }

    /**
     * Runs the calls one after another, then reloads both lists once. A [kind]
     * marks a move the user may want back, offered in a snackbar.
     */
    private fun moves(kind: InboxMoveKind?, calls: () -> List<MoveCall>) {
        val key = workspace ?: return
        if (_uiState.value.busy) return
        val token = generation
        _uiState.update { it.copy(busy = true, error = null, lastMove = null) }
        viewModelScope.launch {
            var error: String? = null
            val undo = mutableListOf<InboxUndo>()
            for (call in calls()) {
                when (val result = call(key)) {
                    is ApiResult.Success -> result.data?.let(undo::add)
                    is ApiResult.Error -> error = result.message
                    is ApiResult.Loading -> Unit
                }
                if (token != generation) return@launch
            }
            _uiState.update {
                it.copy(
                    busy = false,
                    error = error,
                    lastMove = if (kind != null && undo.isNotEmpty()) InboxMove(++moveToken, kind, undo.size, undo) else null,
                )
            }
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

private fun ApiResult<InboxRouting>.routing(): ApiResult<InboxUndo?> = when (this) {
    is ApiResult.Success -> ApiResult.Success(InboxUndo.Routing(data.id))
    is ApiResult.Error -> this
    is ApiResult.Loading -> this
}

private fun ApiResult<*>.none(): ApiResult<InboxUndo?> = when (this) {
    is ApiResult.Success -> ApiResult.Success(null)
    is ApiResult.Error -> this
    is ApiResult.Loading -> this
}
