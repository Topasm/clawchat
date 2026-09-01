package com.clawchat.android.core.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.PendingTodoMutationDao
import com.clawchat.android.core.data.local.PendingTodoMutationEntity
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.activeServerRequestScope
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal data class PendingTodoUpdate(
    val operationId: String,
    val todoId: String,
    val update: TodoUpdate,
    val changedAt: String,
)

private val pendingMutationJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    explicitNulls = false
}

/** Durable, workspace-scoped queue accessed by repositories and the reconnect worker. */
@Singleton
class PendingTodoUpdateStore @Inject constructor(
    private val dao: PendingTodoMutationDao,
    @ApplicationContext private val context: Context,
) {
    suspend fun enqueue(
        workspaceKey: String,
        todoId: String,
        update: TodoUpdate,
        changedAt: String,
    ) {
        dao.insert(
            PendingTodoMutationEntity(
                workspaceKey = workspaceKey,
                operationId = UUID.randomUUID().toString(),
                todoId = todoId,
                payload = pendingMutationJson.encodeToString(
                    update.copy(clientUpdatedAt = null),
                ),
                changedAt = changedAt,
            ),
        )
        TodoSyncWorkScheduler.schedule(context)
    }

    internal suspend fun forWorkspace(workspaceKey: String): List<PendingTodoUpdate> =
        dao.getForWorkspace(workspaceKey).mapNotNull { it.decode() }

    internal suspend fun forTodo(workspaceKey: String, todoId: String): List<PendingTodoUpdate> =
        dao.getForTodo(workspaceKey, todoId).mapNotNull { it.decode() }

    internal suspend fun remove(workspaceKey: String, operationIds: List<String>) {
        if (operationIds.isNotEmpty()) dao.deleteOperations(workspaceKey, operationIds)
    }

    internal suspend fun removeTodo(workspaceKey: String, todoId: String) {
        dao.deleteForTodo(workspaceKey, todoId)
    }

    private fun PendingTodoMutationEntity.decode(): PendingTodoUpdate? = runCatching {
        PendingTodoUpdate(
            operationId = operationId,
            todoId = todoId,
            update = pendingMutationJson.decodeFromString<TodoUpdate>(payload),
            changedAt = changedAt,
        )
    }.getOrNull()
}

internal fun List<PendingTodoUpdate>.mergedUpdate(): TodoUpdate =
    sortedBy(PendingTodoUpdate::changedAt)
        .fold(TodoUpdate()) { accumulated, pending -> accumulated.overlay(pending.update) }
        .copy(clientUpdatedAt = maxOfOrNull(PendingTodoUpdate::changedAt))

internal fun TodoUpdate.overlay(newer: TodoUpdate): TodoUpdate = TodoUpdate(
    title = newer.title ?: title,
    description = newer.description ?: description,
    status = newer.status ?: status,
    priority = newer.priority ?: priority,
    dueDate = newer.dueDate ?: dueDate,
    tags = newer.tags ?: tags,
    sortOrder = newer.sortOrder ?: sortOrder,
    inboxState = newer.inboxState ?: inboxState,
    clientUpdatedAt = newer.clientUpdatedAt ?: clientUpdatedAt,
)

internal fun Todo.applyPending(update: TodoUpdate, changedAt: String): Todo {
    val nextStatus = update.status ?: status
    val nextCompletedAt = when (update.status) {
        com.clawchat.android.core.data.model.TaskStatus.COMPLETED -> completedAt ?: changedAt
        com.clawchat.android.core.data.model.TaskStatus.PENDING,
        com.clawchat.android.core.data.model.TaskStatus.IN_PROGRESS,
        com.clawchat.android.core.data.model.TaskStatus.CANCELLED,
        -> null
        null -> completedAt
    }
    return copy(
        title = update.title ?: title,
        description = update.description ?: description,
        status = nextStatus,
        priority = update.priority ?: priority,
        dueDate = update.dueDate ?: dueDate,
        completedAt = nextCompletedAt,
        tags = update.tags ?: tags,
        sortOrder = update.sortOrder ?: sortOrder,
        inboxState = update.inboxState ?: inboxState,
        syncStatus = "pending",
        updatedAt = changedAt,
    )
}

enum class PendingTodoSyncResult { SUCCESS, RETRY, NO_SESSION }

/** Replays only the newest merged edit per task and lets the latest timestamp win. */
@Singleton
class PendingTodoSyncCoordinator @Inject constructor(
    private val api: ClawChatApi,
    private val todoDao: TodoDao,
    private val store: PendingTodoUpdateStore,
    private val sessionStore: SessionStore,
    private val syncManager: SyncManager,
) {
    suspend fun flush(): PendingTodoSyncResult {
        val state = sessionStore.runtimeState.first()
        if (state.mode != WorkspaceMode.SERVER) return PendingTodoSyncResult.NO_SESSION
        val workspaceKey = state.workspaceKey?.takeIf(String::isNotBlank)
            ?: return PendingTodoSyncResult.NO_SESSION
        val requestScope = state.activeServerRequestScope()
            ?: return PendingTodoSyncResult.NO_SESSION
        val groups = store.forWorkspace(workspaceKey).groupBy(PendingTodoUpdate::todoId)
        var changed = false

        for ((todoId, pending) in groups) {
            if (sessionStore.runtimeState.first().workspaceKey != workspaceKey) {
                return PendingTodoSyncResult.NO_SESSION
            }
            val newestChangedAt = pending.maxOf(PendingTodoUpdate::changedAt)
            when (val remote = apiCall { api.getTodo(todoId, requestScope) }) {
                is ApiResult.Success -> {
                    val serverChangedAt = remote.data.updatedAt.toInstantOrMin()
                    val clientChangedAt = newestChangedAt.toInstantOrMin()
                    val winner = if (serverChangedAt > clientChangedAt) {
                        remote.data
                    } else {
                        when (
                            val update = apiCall {
                                api.updateTodo(
                                    todoId,
                                    pending.mergedUpdate().copy(clientUpdatedAt = newestChangedAt),
                                    requestScope,
                                )
                            }
                        ) {
                            is ApiResult.Success -> update.data
                            is ApiResult.Error -> {
                                if (update.isRetryable()) return PendingTodoSyncResult.RETRY
                                store.remove(workspaceKey, pending.map(PendingTodoUpdate::operationId))
                                continue
                            }
                            ApiResult.Loading -> return PendingTodoSyncResult.RETRY
                        }
                    }
                    todoDao.upsertAll(listOf(winner.toEntity(workspaceKey)))
                    store.remove(workspaceKey, pending.map(PendingTodoUpdate::operationId))
                    changed = true
                }
                is ApiResult.Error -> {
                    if (remote.code == 404) {
                        todoDao.deleteById(workspaceKey, todoId)
                        store.removeTodo(workspaceKey, todoId)
                        changed = true
                    } else if (remote.isRetryable()) {
                        return PendingTodoSyncResult.RETRY
                    } else {
                        store.remove(workspaceKey, pending.map(PendingTodoUpdate::operationId))
                    }
                }
                ApiResult.Loading -> return PendingTodoSyncResult.RETRY
            }
        }
        if (changed) syncManager.notifyTodoChanged()
        return PendingTodoSyncResult.SUCCESS
    }
}

private fun ApiResult.Error.isRetryable(): Boolean =
    code == null || code in setOf(408, 425, 429) || code >= 500

private fun String.toInstantOrMin(): Instant =
    runCatching { Instant.parse(this) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(this).toInstant() }.getOrNull()
        // SQLite can return a server UTC timestamp without an explicit offset.
        ?: runCatching { LocalDateTime.parse(this).toInstant(ZoneOffset.UTC) }.getOrNull()
        ?: Instant.MIN

class PendingTodoSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val coordinator = EntryPointAccessors.fromApplication(
            applicationContext,
            PendingTodoSyncEntryPoint::class.java,
        ).coordinator()
        return when (coordinator.flush()) {
            PendingTodoSyncResult.SUCCESS,
            PendingTodoSyncResult.NO_SESSION,
            -> Result.success()
            PendingTodoSyncResult.RETRY -> Result.retry()
        }
    }
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface PendingTodoSyncEntryPoint {
    fun coordinator(): PendingTodoSyncCoordinator
}

object TodoSyncWorkScheduler {
    private const val WORK_NAME = "clawchat_pending_todo_sync"

    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<PendingTodoSyncWorker>()
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
