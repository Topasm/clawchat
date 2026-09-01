package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.DeviceZoneProvider
import com.clawchat.android.core.data.local.LocalTodoDao
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.local.toLocalEntity
import com.clawchat.android.core.data.local.toModel
import com.clawchat.android.core.data.local.toStoredDueDate
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import com.clawchat.android.core.notification.ReminderNotificationController
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.sync.PendingTodoUpdate
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import com.clawchat.android.core.sync.applyPending
import com.clawchat.android.core.sync.mergedUpdate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

interface TodoRepository {
    suspend fun listTodos(params: Map<String, String> = emptyMap()): ApiResult<PaginatedResponse<Todo>>
    suspend fun getTodo(id: String): ApiResult<Todo>
    suspend fun createTodo(
        body: TodoCreate,
        expectedWorkspaceKey: String? = null,
    ): ApiResult<Todo>
    suspend fun updateTodo(
        id: String,
        body: TodoUpdate,
        expectedWorkspaceKey: String? = null,
    ): ApiResult<Todo>
    suspend fun deleteTodo(id: String, expectedWorkspaceKey: String? = null): ApiResult<Unit>
    suspend fun organizeTodo(todoId: String): ApiResult<Unit>
    fun getCachedTodosFlow(): Flow<List<Todo>>
}

@Singleton
class TodoRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
    private val todoDao: TodoDao,
    private val localTodoDao: LocalTodoDao,
    private val sessionStore: SessionStore,
    private val deviceZoneProvider: DeviceZoneProvider,
    private val syncManager: SyncManager,
    private val pendingUpdates: PendingTodoUpdateStore,
    private val reminderNotifications: ReminderNotificationController,
) : TodoRepository {

    override suspend fun listTodos(params: Map<String, String>): ApiResult<PaginatedResponse<Todo>> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                val limit = params["limit"]?.toIntOrNull()?.coerceAtLeast(0) ?: 50
                val page = params["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1
                val offset = ((page - 1).toLong() * limit)
                    .coerceAtMost(Int.MAX_VALUE.toLong())
                    .toInt()
                val zoneId = deviceZoneProvider.current()
                val dueBeforeExclusive = try {
                    params["due_before"]?.let { value ->
                        LocalDate.parse(value.toStoredDueDate(zoneId)).plusDays(1).toString()
                    }
                } catch (error: IllegalArgumentException) {
                    return ApiResult.Error(error.message ?: "Invalid due_before", code = 422)
                }
                if (params.containsKey("project_id")) {
                    return ApiResult.Error("Projects require a server", code = 422)
                }
                val requestedOrder = params["order_by"]
                val orderBy = when (requestedOrder) {
                    null -> "default"
                    "created_at", "updated_at", "sort_order", "priority", "due_date" ->
                        requestedOrder
                    else -> "created_at"
                }
                val localPage = localTodoDao.loadPage(
                    status = params["status"],
                    priority = params["priority"],
                    inboxState = params["inbox_state"],
                    filterParent = params.containsKey("parent_id"),
                    parentId = params["parent_id"],
                    rootOnly = params["root_only"] == "true",
                    dueBeforeExclusive = dueBeforeExclusive,
                    orderBy = orderBy,
                    ascending = params["order_dir"] == "asc",
                    limit = limit,
                    offset = offset,
                )
                return ApiResult.Success(
                    PaginatedResponse(
                        items = localPage.items.map { it.toModel() },
                        total = localPage.total,
                        page = page,
                        limit = limit,
                    ),
                )
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.listTodos(params, expectedScope) }
        if (result is ApiResult.Success) {
            val mergedItems = mergePending(workspaceKey, result.data.items)
            todoDao.upsertAll(mergedItems.map { it.toEntity(workspaceKey) })
            return ApiResult.Success(result.data.copy(items = mergedItems))
        }
        return result
    }

    override suspend fun getTodo(id: String): ApiResult<Todo> {
        val runtimeState = currentRuntimeState()
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                val todo = localTodoDao.getById(id)?.toModel()
                    ?: return ApiResult.Error("Local task not found", code = 404)
                return ApiResult.Success(todo)
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.getTodo(id, expectedScope) }
        if (result is ApiResult.Success) {
            val merged = mergePending(workspaceKey, listOf(result.data)).single()
            todoDao.upsertAll(listOf(merged.toEntity(workspaceKey)))
            return ApiResult.Success(merged)
        }
        return result
    }

    override suspend fun createTodo(
        body: TodoCreate,
        expectedWorkspaceKey: String?,
    ): ApiResult<Todo> {
        val runtimeState = currentRuntimeState()
        runtimeState.workspaceMismatch(expectedWorkspaceKey)?.let { return it }
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                val now = Instant.now().toString()
                val entity = try {
                    body.copy(title = body.title.trim()).toLocalEntity(
                        id = body.localOperationId(),
                        now = now,
                        zoneId = deviceZoneProvider.current(),
                    )
                } catch (error: IllegalArgumentException) {
                    return ApiResult.Error(error.message ?: "Invalid local task", code = 422)
                }
                val created = localTodoDao.insertOrGet(entity).toModel()
                syncManager.notifyTodoChanged()
                return ApiResult.Success(created)
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.createTodo(body, expectedScope) }
        if (result is ApiResult.Success) {
            todoDao.upsertAll(listOf(result.data.toEntity(workspaceKey)))
            syncManager.notifyTodoChanged()
        }
        return result
    }

    override suspend fun updateTodo(
        id: String,
        body: TodoUpdate,
        expectedWorkspaceKey: String?,
    ): ApiResult<Todo> {
        val runtimeState = currentRuntimeState()
        runtimeState.workspaceMismatch(expectedWorkspaceKey)?.let { return it }
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                val updated = try {
                    localTodoDao.updateExisting(
                        id,
                        body,
                        Instant.now().toString(),
                        deviceZoneProvider.current(),
                    ) ?: return ApiResult.Error("Local task not found", code = 404)
                } catch (error: IllegalArgumentException) {
                    return ApiResult.Error(error.message ?: "Invalid local task", code = 422)
                }
                val updatedTodo = updated.toModel()
                if (updatedTodo.status in TERMINAL_TASK_STATUSES) {
                    reminderNotifications.dismissTodo(runtimeState.workspaceKey, id)
                }
                syncManager.notifyTodoChanged()
                return ApiResult.Success(updatedTodo)
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val changedAt = Instant.now().toString()
        val previousPending = pendingUpdates.forTodo(workspaceKey, id)
        val currentPending = PendingTodoUpdate(
            operationId = "current",
            todoId = id,
            update = body,
            changedAt = changedAt,
        )
        val outbound = (previousPending + currentPending).mergedUpdate()
        val result = apiCall { api.updateTodo(id, outbound, expectedScope) }
        if (result is ApiResult.Success) {
            pendingUpdates.remove(workspaceKey, previousPending.map(PendingTodoUpdate::operationId))
            todoDao.upsertAll(listOf(result.data.toEntity(workspaceKey)))
            if (result.data.status in TERMINAL_TASK_STATUSES) {
                reminderNotifications.dismissTodo(workspaceKey, id)
            }
            syncManager.notifyTodoChanged()
            return result
        }
        if (result is ApiResult.Error && result.isRetryableMutationFailure()) {
            val cached = todoDao.getById(workspaceKey, id)?.toModel() ?: return result
            pendingUpdates.enqueue(workspaceKey, id, body, changedAt)
            val optimistic = cached.applyPending(body, changedAt)
            todoDao.upsertAll(listOf(optimistic.toEntity(workspaceKey)))
            if (optimistic.status in TERMINAL_TASK_STATUSES) {
                reminderNotifications.dismissTodo(workspaceKey, id)
            }
            syncManager.notifyTodoChanged()
            return ApiResult.Success(optimistic)
        }
        return result
    }

    override suspend fun deleteTodo(
        id: String,
        expectedWorkspaceKey: String?,
    ): ApiResult<Unit> {
        val runtimeState = currentRuntimeState()
        runtimeState.workspaceMismatch(expectedWorkspaceKey)?.let { return it }
        when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> return workspaceNotConfigured()
            WorkspaceMode.SERVER -> Unit
            WorkspaceMode.LOCAL -> {
                localTodoDao.deleteById(id)
                reminderNotifications.dismissTodo(runtimeState.workspaceKey, id)
                syncManager.notifyTodoChanged()
                return ApiResult.Success(Unit)
            }
        }
        val workspaceKey = runtimeState.workspaceKey?.takeIf(String::isNotBlank)
            ?: return workspaceNotConfigured()
        val expectedScope = runtimeState.activeServerRequestScope()
            ?: return workspaceNotConfigured()
        val result = apiCall { api.deleteTodo(id, expectedScope) }
        if (result is ApiResult.Success) {
            todoDao.deleteById(workspaceKey, id)
            reminderNotifications.dismissTodo(workspaceKey, id)
            syncManager.notifyTodoChanged()
        }
        return result
    }

    override suspend fun organizeTodo(todoId: String): ApiResult<Unit> {
        val runtimeState = currentRuntimeState()
        return when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.LOCAL -> ApiResult.Error("AI organization requires a server")
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                when (val result = apiCall { api.organizeTodo(todoId, expectedScope) }) {
                    is ApiResult.Success -> {
                        if (!result.data.isSuccessful) {
                            return ApiResult.Error(
                                message = "HTTP ${result.data.code()}",
                                code = result.data.code(),
                            )
                        }
                        ApiResult.Success(Unit)
                    }
                    is ApiResult.Error -> result
                    is ApiResult.Loading -> result
                }
            }
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    override fun getCachedTodosFlow(): Flow<List<Todo>> =
        sessionStore.runtimeState
            .map { state -> state.mode to state.workspaceKey }
            .distinctUntilChanged()
            .flatMapLatest { (mode, workspaceKey) ->
                when (mode) {
                    WorkspaceMode.LOCAL -> localTodoDao.getAllFlow()
                        .map { entities -> entities.map { it.toModel() } }
                    WorkspaceMode.SERVER -> workspaceKey
                        ?.takeIf(String::isNotBlank)
                        ?.let { key ->
                            todoDao.getAllFlow(key)
                                .map { entities -> entities.map { it.toModel() } }
                        }
                        ?: flowOf(emptyList())
                    WorkspaceMode.UNCONFIGURED -> flowOf(emptyList())
                }
            }

    private suspend fun currentRuntimeState(): AppRuntimeState = sessionStore.runtimeState.first()

    private suspend fun mergePending(workspaceKey: String, todos: List<Todo>): List<Todo> {
        val pendingByTodo = pendingUpdates.forWorkspace(workspaceKey)
            .groupBy(PendingTodoUpdate::todoId)
        return todos.map { todo ->
            val pending = pendingByTodo[todo.id].orEmpty()
            if (pending.isEmpty()) {
                todo
            } else {
                todo.applyPending(
                    update = pending.mergedUpdate(),
                    changedAt = pending.maxOf(PendingTodoUpdate::changedAt),
                )
            }
        }
    }

    private fun TodoCreate.localOperationId(): String = idempotencyKey
        ?.trim()
        ?.takeIf(String::isNotEmpty)
        ?.let { operationKey ->
            UUID.nameUUIDFromBytes(
                "clawchat-local-todo:$operationKey".toByteArray(Charsets.UTF_8),
            ).toString()
        }
        ?: UUID.randomUUID().toString()

}

private fun ApiResult.Error.isRetryableMutationFailure(): Boolean =
    code == null || code in setOf(408, 425, 429) || code >= 500

private val TERMINAL_TASK_STATUSES = setOf(TaskStatus.COMPLETED, TaskStatus.CANCELLED)
