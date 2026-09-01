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
import com.clawchat.android.core.data.model.TodoQuestionAnswersRequest
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import com.clawchat.android.core.notification.ReminderNotificationController
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.sync.PendingTodoUpdate
import com.clawchat.android.core.sync.PendingTodoUpdateStore
import com.clawchat.android.core.sync.PendingTodoCreate
import com.clawchat.android.core.sync.PendingTodoDelete
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
    suspend fun answerTodoQuestions(todoId: String, answers: Map<String, String>): ApiResult<Unit>
    suspend fun skipTodoQuestions(todoId: String): ApiResult<Unit>
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
        if (result is ApiResult.Error && result.isRetryableMutationFailure()) {
            return cachedServerTodos(workspaceKey, params)
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
        val operationId = body.idempotencyKey
            ?.trim()
            ?.takeIf(String::isNotEmpty)
            ?: UUID.randomUUID().toString()
        if (runCatching { UUID.fromString(operationId) }.isFailure) {
            return ApiResult.Error("Invalid idempotency key", code = 422)
        }
        val outbound = body.copy(idempotencyKey = operationId)
        val result = apiCall { api.createTodo(outbound, expectedScope) }
        if (result is ApiResult.Success) {
            todoDao.upsertAll(listOf(result.data.toEntity(workspaceKey)))
            syncManager.notifyTodoChanged()
            return result
        }
        if (result is ApiResult.Error && result.isRetryableMutationFailure()) {
            val changedAt = Instant.now().toString()
            pendingUpdates.enqueueCreate(workspaceKey, operationId, outbound, changedAt)
            val optimistic = outbound.toPendingTodo(operationId, changedAt)
            todoDao.upsertAll(listOf(optimistic.toEntity(workspaceKey)))
            syncManager.notifyTodoChanged()
            return ApiResult.Success(optimistic)
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
        val changedAt = Instant.now().toString()
        if (pendingUpdates.hasPendingCreate(workspaceKey, id)) {
            pendingUpdates.enqueueDelete(workspaceKey, id, changedAt)
            todoDao.deleteById(workspaceKey, id)
            reminderNotifications.dismissTodo(workspaceKey, id)
            syncManager.notifyTodoChanged()
            return ApiResult.Success(Unit)
        }
        val result = apiCall { api.deleteTodo(id, expectedScope) }
        if (result is ApiResult.Success) {
            pendingUpdates.removeTodo(workspaceKey, id)
            todoDao.deleteById(workspaceKey, id)
            reminderNotifications.dismissTodo(workspaceKey, id)
            syncManager.notifyTodoChanged()
            return result
        }
        if (result is ApiResult.Error && result.isRetryableMutationFailure()) {
            pendingUpdates.enqueueDelete(workspaceKey, id, changedAt)
            todoDao.deleteById(workspaceKey, id)
            reminderNotifications.dismissTodo(workspaceKey, id)
            syncManager.notifyTodoChanged()
            return ApiResult.Success(Unit)
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

    override suspend fun answerTodoQuestions(
        todoId: String,
        answers: Map<String, String>,
    ): ApiResult<Unit> {
        val normalized = answers.mapValues { (_, answer) -> answer.trim() }
        if (normalized.isEmpty() || normalized.values.any(String::isEmpty)) {
            return ApiResult.Error("Answer every question before continuing", code = 422)
        }
        return runQuestionAction(todoId) { expectedScope ->
            api.answerTodoQuestions(
                todoId,
                TodoQuestionAnswersRequest(normalized),
                expectedScope,
            )
        }
    }

    override suspend fun skipTodoQuestions(todoId: String): ApiResult<Unit> =
        runQuestionAction(todoId) { expectedScope ->
            api.skipTodoQuestions(todoId, expectedScope)
        }

    private suspend fun runQuestionAction(
        todoId: String,
        request: suspend (com.clawchat.android.core.network.ExpectedSessionScope) ->
            com.clawchat.android.core.data.model.TodoWorkflowResponse,
    ): ApiResult<Unit> {
        val runtimeState = currentRuntimeState()
        return when (runtimeState.mode) {
            WorkspaceMode.UNCONFIGURED -> workspaceNotConfigured()
            WorkspaceMode.LOCAL -> ApiResult.Error("AI planning questions require a server")
            WorkspaceMode.SERVER -> {
                val expectedScope = runtimeState.activeServerRequestScope()
                    ?: return workspaceNotConfigured()
                when (val result = apiCall { request(expectedScope) }) {
                    is ApiResult.Success -> if (
                        result.data.status == "processing" && result.data.todoId == todoId
                    ) {
                        ApiResult.Success(Unit)
                    } else {
                        ApiResult.Error(
                            message = "Task is no longer waiting for answers",
                            code = 409,
                        )
                    }
                    is ApiResult.Error -> result
                    ApiResult.Loading -> ApiResult.Loading
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
        val mutations = pendingUpdates.allForWorkspace(workspaceKey)
        val updatesByTodo = mutations.filterIsInstance<PendingTodoUpdate>()
            .groupBy(PendingTodoUpdate::todoId)
        val createsByOperation = mutations.filterIsInstance<PendingTodoCreate>()
            .associateBy(PendingTodoCreate::operationId)
        val deletedTodoIds = mutations.filterIsInstance<PendingTodoDelete>()
            .mapTo(mutableSetOf(), PendingTodoDelete::todoId)
        val matchedCreateIds = mutableSetOf<String>()

        val remote = todos.mapNotNull { todo ->
            val pendingCreate = todo.idempotencyKey?.let(createsByOperation::get)
            val mutationTodoId = pendingCreate?.todoId ?: todo.id
            if (pendingCreate != null) matchedCreateIds += pendingCreate.todoId
            if (mutationTodoId in deletedTodoIds || todo.id in deletedTodoIds) return@mapNotNull null
            val updates = updatesByTodo[mutationTodoId].orEmpty() + updatesByTodo[todo.id].orEmpty()
            when {
                updates.isNotEmpty() -> todo.applyPending(
                    update = updates.mergedUpdate(),
                    changedAt = updates.maxOf(PendingTodoUpdate::changedAt),
                )
                pendingCreate != null -> todo.copy(syncStatus = "pending")
                else -> todo
            }
        }

        val localCreates = mutations.filterIsInstance<PendingTodoCreate>()
            .filterNot { it.todoId in matchedCreateIds || it.todoId in deletedTodoIds }
            .mapNotNull { todoDao.getById(workspaceKey, it.todoId)?.toModel() }
            .map { it.copy(syncStatus = "pending") }
        return localCreates + remote
    }

    private suspend fun cachedServerTodos(
        workspaceKey: String,
        params: Map<String, String>,
    ): ApiResult<PaginatedResponse<Todo>> {
        val mutations = pendingUpdates.allForWorkspace(workspaceKey)
        val pendingIds = mutations
            .mapTo(mutableSetOf()) { it.todoId }
        val deletedIds = mutations
            .filterIsInstance<PendingTodoDelete>()
            .mapTo(mutableSetOf(), PendingTodoDelete::todoId)
        var cached = todoDao.getAll(workspaceKey)
            .asSequence()
            .map { it.toModel() }
            .filterNot { it.id in deletedIds }
            .map { todo -> if (todo.id in pendingIds) todo.copy(syncStatus = "pending") else todo }
        params["status"]?.let { status -> cached = cached.filter { it.status.wireValue == status } }
        params["priority"]?.let { priority -> cached = cached.filter { it.priority == priority } }
        params["inbox_state"]?.let { inbox -> cached = cached.filter { it.inboxState == inbox } }
        params["due_before"]?.let { dueBefore ->
            cached = cached.filter { it.dueDate != null && it.dueDate < dueBefore }
        }
        if (params["root_only"] == "true") cached = cached.filter { it.parentId == null }
        val all = cached.toList()
        val limit = params["limit"]?.toIntOrNull()?.coerceAtLeast(0) ?: 50
        val page = params["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1
        val offset = ((page - 1).toLong() * limit).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        return ApiResult.Success(
            PaginatedResponse(
                items = all.drop(offset).take(limit),
                total = all.size,
                page = page,
                limit = limit,
            ),
        )
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

    private fun TodoCreate.toPendingTodo(id: String, changedAt: String): Todo = Todo(
        id = id,
        title = title,
        description = description,
        priority = priority,
        dueDate = dueDate,
        tags = tags,
        parentId = parentId,
        source = source,
        idempotencyKey = idempotencyKey,
        inboxState = inboxState ?: "none",
        syncStatus = "pending",
        createdAt = changedAt,
        updatedAt = changedAt,
    )

}

private fun ApiResult.Error.isRetryableMutationFailure(): Boolean =
    code == null || code in setOf(408, 425, 429) || code >= 500

private val TERMINAL_TASK_STATUSES = setOf(TaskStatus.COMPLETED, TaskStatus.CANCELLED)
