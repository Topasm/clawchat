package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/** What the Inbox shows: what it just filed, and the captures still waiting for the user. */
data class InboxSnapshot(
    val routings: List<InboxRouting> = emptyList(),
    val captures: List<Todo> = emptyList(),
    /** Project of each loaded task, so a filed task can name the project it landed in. */
    val projectOf: Map<String, String> = emptyMap(),
    val projects: List<ProjectPlan> = emptyList(),
    val candidates: List<ProjectFolderCandidate> = emptyList(),
)

/** Inbox states in the order the web lists them: being read, asking, planned, failed, captured. */
private val CAPTURE_ORDER = listOf("classifying", "planning", "questioning", "plan_ready", "error", "captured")

class InboxRoutingRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessions: SessionStore,
) {
    private suspend fun <T> scoped(workspace: String, call: suspend (ExpectedSessionScope) -> T): ApiResult<T> {
        val runtime = sessions.runtimeState.first()
        runtime.workspaceMismatch(workspace)?.let { return it }
        if (runtime.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = runtime.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall { call(scope) }
    }

    suspend fun load(workspace: String) = scoped(workspace) { scope ->
        coroutineScope {
            val routings = async { api.listInboxRoutings(scope) }
            val todos = async { api.listTodos(mapOf("limit" to "200"), scope) }
            val projects = async { api.listProjects(scope) }
            // Candidates only add an import shortcut; an older server without the
            // endpoint still shows the Inbox.
            val candidates = async { runCatching { api.listProjectCandidates(scope) }.getOrDefault(emptyList()) }
            val items = todos.await().items
            InboxSnapshot(
                routings = routings.await().items,
                captures = items.filter { it.isInboxCapture() }
                    .sortedBy { CAPTURE_ORDER.indexOf(it.inboxState).let { rank -> if (rank < 0) CAPTURE_ORDER.size else rank } },
                projectOf = items.mapNotNull { todo -> todo.projectId?.let { todo.id to it } }.toMap(),
                projects = projects.await(),
                candidates = candidates.await(),
            )
        }
    }

    suspend fun undo(workspace: String, routingId: String) = scoped(workspace) { api.undoInboxRouting(routingId, it) }

    suspend fun toNote(workspace: String, todoId: String) = scoped(workspace) { api.todoToNote(todoId, it) }

    suspend fun fileAsTask(workspace: String, todoId: String) = scoped(workspace) { api.fileTodoAsTask(todoId, it) }

    suspend fun noteToTask(workspace: String, noteId: String) = scoped(workspace) { api.noteToTask(noteId, it) }

    /** Put a filed task at the top of [projectId], against the graph as it is now. */
    suspend fun placeTask(workspace: String, todoId: String, projectId: String) = scoped(workspace) { scope ->
        val revision = api.getInboxGraph(scope).revision
        api.applyInboxPlacement(todoId, InboxPlacementRequest(projectId, null, "none", revision), scope)
    }

    suspend fun moveNote(workspace: String, noteId: String, projectId: String?) =
        scoped(workspace) { api.moveNote(noteId, NoteMove(projectId), it) }

    suspend fun importCandidate(workspace: String, candidate: ProjectFolderCandidate) =
        scoped(workspace) { api.createProject(ProjectCreate(candidate.name, candidate.folder), it) }
}

/** Still in the Inbox: not filed (`none`) and not finished. */
internal fun Todo.isInboxCapture(): Boolean =
    inboxState != null && inboxState != "none" &&
        status != TaskStatus.COMPLETED && status != TaskStatus.CANCELLED
