package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.LocalNoteDao
import com.clawchat.android.core.data.local.LocalNoteEntity
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.network.*
import kotlinx.coroutines.flow.first
import java.time.Instant
import javax.inject.Inject

data class NoteSnapshot(val notes: List<Note>, val projects: List<ProjectPlan>)

class NoteRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessions: SessionStore,
    private val notes: LocalNoteDao,
    private val todos: LocalTodoDao,
) {
    private suspend fun <T> scoped(workspace: String, local: suspend () -> T, remote: suspend (ExpectedSessionScope) -> T): ApiResult<T> {
        val runtime = sessions.runtimeState.first()
        runtime.workspaceMismatch(workspace)?.let { return it }
        return if (runtime.mode == WorkspaceMode.LOCAL) apiCall { local() }
        else {
            val scope = runtime.activeServerRequestScope() ?: return workspaceNotConfigured()
            apiCall { remote(scope) }
        }
    }

    suspend fun load(workspace: String) = scoped(workspace,
        local = { NoteSnapshot(notes.list().map { it.toNote() }, todos.getAllFlow().first()
            .filter { it.source == "project_root" }.map { ProjectPlan(it.id, it.title) }) },
        remote = { NoteSnapshot(api.listNotes(it), api.listProjects(it)) },
    )

    suspend fun create(workspace: String, body: NoteCreate) = scoped(workspace,
        local = {
            val id = "note_${body.idempotencyKey}"
            val now = Instant.now().toString()
            notes.insert(LocalNoteEntity(id, body.content.trim(), body.projectId, now, now))
            val stored = requireNotNull(notes.get(id))
            check(stored.content == body.content.trim() && stored.projectId == body.projectId) { "Capture key conflict" }
            stored.toNote()
        }, remote = { api.createNote(body, it) },
    )

    suspend fun edit(workspace: String, id: String, content: String) = scoped(workspace,
        local = { notes.edit(id, content.trim(), Instant.now().toString()); requireNotNull(notes.get(id)).toNote() },
        remote = { api.editNote(id, NoteContentUpdate(content.trim()), it) },
    )

    suspend fun move(workspace: String, id: String, projectId: String?) = scoped(workspace,
        local = { notes.move(id, projectId, Instant.now().toString()); requireNotNull(notes.get(id)).toNote() },
        remote = { api.moveNote(id, NoteMove(projectId), it) },
    )

    suspend fun delete(workspace: String, id: String) = scoped(workspace,
        local = { notes.delete(id) }, remote = { api.deleteNote(id, it) },
    )
}
