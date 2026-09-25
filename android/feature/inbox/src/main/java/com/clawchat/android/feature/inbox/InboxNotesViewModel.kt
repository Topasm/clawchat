package com.clawchat.android.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.data.repository.NoteRepository
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class InboxNotesState(
    val workspace: String? = null,
    val notes: List<Note> = emptyList(),
    val projects: List<ProjectPlan> = emptyList(),
    val projectId: String? = null,
    val draft: String = "",
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: Boolean = false,
    val undoMove: Pair<String, String?>? = null,
)

@HiltViewModel
class InboxNotesViewModel @Inject constructor(
    private val repository: NoteRepository,
    sessions: SessionStore,
) : ViewModel() {
    private val mutable = MutableStateFlow(InboxNotesState())
    val state = mutable.asStateFlow()
    private var generation = 0L
    private var loadJob: Job? = null
    private var actionJob: Job? = null
    private var captureKey = UUID.randomUUID().toString()

    init {
        viewModelScope.launch {
            sessions.runtimeState.map { it.workspaceKey }.distinctUntilChanged().collect { key ->
                generation++
                loadJob?.cancel(); actionJob?.cancel()
                captureKey = UUID.randomUUID().toString()
                mutable.value = InboxNotesState(workspace = key)
                refresh()
            }
        }
    }

    fun draft(text: String) {
        if (mutable.value.busy) return
        captureKey = UUID.randomUUID().toString()
        mutable.update { it.copy(draft = text, error = false) }
    }

    fun selectProject(id: String?) {
        if (mutable.value.busy) return
        captureKey = UUID.randomUUID().toString()
        mutable.update { it.copy(projectId = id) }
    }

    fun refresh() {
        val workspace = mutable.value.workspace ?: return
        if (mutable.value.busy || loadJob?.isActive == true) return
        val expected = generation
        mutable.update { it.copy(loading = true) }
        loadJob = viewModelScope.launch {
            val result = repository.load(workspace)
            if (expected != generation) return@launch
            mutable.update {
                when (result) {
                    is ApiResult.Success -> it.copy(notes = result.data.notes, projects = result.data.projects,
                        projectId = it.projectId?.takeIf { id -> result.data.projects.any { project -> project.id == id } }, loading = false, error = false)
                    else -> it.copy(loading = false, error = true)
                }
            }
        }
    }

    private fun action(block: suspend (String) -> ApiResult<*>, success: () -> Unit = {}) {
        val workspace = mutable.value.workspace ?: return
        if (mutable.value.busy) return
        val expected = generation
        loadJob?.cancel()
        mutable.update { it.copy(busy = true, loading = false, error = false) }
        actionJob = viewModelScope.launch {
            val result = block(workspace)
            if (expected != generation) return@launch
            mutable.update { it.copy(busy = false, error = result !is ApiResult.Success) }
            if (result is ApiResult.Success) { success(); refresh() }
        }
    }

    fun create() {
        val snapshot = mutable.value
        if (snapshot.draft.trim().length !in 1..20_000) return
        action({ repository.create(it, NoteCreate(snapshot.draft.trim(), snapshot.projectId, captureKey)) }) {
            captureKey = UUID.randomUUID().toString()
            mutable.update { it.copy(draft = "") }
        }
    }

    fun edit(id: String, content: String, onSaved: () -> Unit) {
        if (content.trim().length !in 1..20_000) return
        action({ repository.edit(it, id, content) }, onSaved)
    }

    fun move(id: String, project: String?) {
        val note = mutable.value.notes.find { it.id == id } ?: return
        if (project == note.projectId || (project != null && mutable.value.projects.none { it.id == project })) return
        action({ repository.move(it, id, project) }) {
            mutable.update { it.copy(undoMove = id to note.projectId) }
        }
    }

    fun undo() {
        val previous = mutable.value.undoMove ?: return
        action({ repository.move(it, previous.first, previous.second) }) {
            mutable.update { it.copy(undoMove = null) }
        }
    }

    fun delete(id: String, onDeleted: () -> Unit) = action({ repository.delete(it, id) }) {
        mutable.update { it.copy(undoMove = null) }; onDeleted()
    }
}
