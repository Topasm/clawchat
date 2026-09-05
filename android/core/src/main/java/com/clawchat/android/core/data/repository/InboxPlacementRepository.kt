package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.network.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject

data class InboxPlacementSnapshot(
    val tasks: List<Todo>,
    val total: Int,
    val projects: List<ProjectPlan>,
    val graph: InboxGraph,
    val review: InboxReviewState = InboxReviewState(),
)

class InboxPlacementRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessions: SessionStore,
    private val todos: TodoRepository,
) {
    val scopes = sessions.runtimeState.map {
        if (it.mode == WorkspaceMode.SERVER) it.activeServerRequestScope() else null
    }.distinctUntilChanged()

    private suspend fun <T> request(scope: ExpectedSessionScope, action: suspend () -> T): ApiResult<T> {
        if (scopes.first() != scope) return ApiResult.Error("Workspace changed. Refresh suggestions.")
        return apiCall { action() }
    }

    suspend fun load(scope: ExpectedSessionScope, page: Int = 1) = request(scope) {
        // Capture revision BEFORE reading labels/tasks. Concurrent edits then make
        // preview/apply stale instead of authorizing an older card at a newer revision.
        val graph = api.getInboxGraph(scope)
        val tasks = api.listTodos(mapOf("inbox_state" to "captured", "status" to "pending", "limit" to "50", "page" to page.toString()), scope)
        // Older servers may ignore the new filter. Never propose moving ordinary tasks.
        val captures = tasks.items.filter { it.inboxState == "captured" && it.status == TaskStatus.PENDING }
        InboxPlacementSnapshot(captures, tasks.total, api.listProjects(scope), graph, api.getInboxReview(scope))
    }

    suspend fun saveReview(scope: ExpectedSessionScope, id: String, body: InboxReviewUpdate) = request(scope) {
        api.saveInboxReview(id, body, scope)
    }

    suspend fun resumeReview(scope: ExpectedSessionScope) = request(scope) { api.resumeInboxReview(scope) }

    suspend fun preview(scope: ExpectedSessionScope, ids: List<String>, revision: Long) = request(scope) {
        api.previewInboxPlacement(InboxTriageRequest(ids, revision, java.time.ZoneId.systemDefault().id), scope)
    }

    suspend fun approve(scope: ExpectedSessionScope, id: String, destination: InboxPlacementRequest) = request(scope) {
        api.applyInboxPlacement(id, destination, scope)
    }

    suspend fun undo(scope: ExpectedSessionScope, changeId: String) = request(scope) {
        api.undoInboxPlacement(changeId, scope)
    }

    suspend fun capture(owner: ExpectedSessionScope?, raw: String, operationId: String, capturedAt: String): ApiResult<Todo> {
        val runtime = sessions.runtimeState.first()
        val current = if (runtime.mode == WorkspaceMode.SERVER) runtime.activeServerRequestScope() else null
        if (current != owner || runtime.workspaceKey == null) return workspaceNotConfigured()
        return todos.createTodo(TodoCreate(title = raw.trim(), source = "android_inbox",
            inboxState = "captured", idempotencyKey = operationId, capturedAt = capturedAt), runtime.workspaceKey)
    }
}
