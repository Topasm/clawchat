package com.clawchat.android.core.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.api.ReviewApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.local.PendingTodoMutationDao
import com.clawchat.android.core.data.local.PendingTodoMutationEntity
import com.clawchat.android.core.data.local.PendingReviewDecisionDao
import com.clawchat.android.core.data.local.PendingReviewDecisionEntity
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.local.toEntity
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.ReviewDecisionRequest
import com.clawchat.android.core.data.model.ReviewStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.data.repository.activeServerRequestScope
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
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
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal sealed interface PendingTodoMutation {
    val operationId: String
    val todoId: String
    val changedAt: String
}

internal data class PendingTodoCreate(
    override val operationId: String,
    override val todoId: String,
    val create: TodoCreate,
    override val changedAt: String,
) : PendingTodoMutation

internal data class PendingTodoUpdate(
    override val operationId: String,
    override val todoId: String,
    val update: TodoUpdate,
    override val changedAt: String,
) : PendingTodoMutation

internal data class PendingTodoDelete(
    override val operationId: String,
    override val todoId: String,
    override val changedAt: String,
) : PendingTodoMutation

data class PendingSyncStatus(
    val pendingCount: Int = 0,
    val hasFailure: Boolean = false,
)

private val pendingMutationJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    explicitNulls = false
}

private const val REQUEST_INCOMPLETE_ERROR = "Network request did not complete"
private const val OUTBOX_INITIAL_RETRY_SECONDS = 30L

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
        dao.clearDiagnostics(workspaceKey, todoId)
        dao.insert(
            PendingTodoMutationEntity(
                workspaceKey = workspaceKey,
                operationId = UUID.randomUUID().toString(),
                todoId = todoId,
                operationType = PendingTodoOperation.UPDATE.wireValue,
                payload = pendingMutationJson.encodeToString(
                    update.copy(clientUpdatedAt = null),
                ),
                changedAt = changedAt,
            ),
        )
        TodoSyncWorkScheduler.schedule(context)
    }

    suspend fun enqueueCreate(
        workspaceKey: String,
        operationId: String,
        create: TodoCreate,
        changedAt: String,
    ) {
        dao.clearDiagnostics(workspaceKey, operationId)
        dao.insert(
            PendingTodoMutationEntity(
                workspaceKey = workspaceKey,
                operationId = operationId,
                todoId = operationId,
                operationType = PendingTodoOperation.CREATE.wireValue,
                payload = pendingMutationJson.encodeToString(create),
                changedAt = changedAt,
            ),
        )
        TodoSyncWorkScheduler.schedule(context)
    }

    suspend fun enqueueDelete(workspaceKey: String, todoId: String, changedAt: String) {
        dao.clearDiagnostics(workspaceKey, todoId)
        dao.insert(
            PendingTodoMutationEntity(
                workspaceKey = workspaceKey,
                operationId = UUID.randomUUID().toString(),
                todoId = todoId,
                operationType = PendingTodoOperation.DELETE.wireValue,
                payload = "{}",
                changedAt = changedAt,
            ),
        )
        TodoSyncWorkScheduler.schedule(context)
    }

    internal suspend fun allForWorkspace(workspaceKey: String): List<PendingTodoMutation> =
        dao.getForWorkspace(workspaceKey).mapNotNull { it.decodeMutation() }

    internal suspend fun forWorkspace(workspaceKey: String): List<PendingTodoUpdate> =
        allForWorkspace(workspaceKey).filterIsInstance<PendingTodoUpdate>()

    internal suspend fun forTodo(workspaceKey: String, todoId: String): List<PendingTodoUpdate> =
        dao.getForTodo(workspaceKey, todoId).mapNotNull { it.decodeMutation() as? PendingTodoUpdate }

    internal suspend fun hasPendingCreate(workspaceKey: String, todoId: String): Boolean =
        dao.getForTodo(workspaceKey, todoId).any {
            it.operationType == PendingTodoOperation.CREATE.wireValue
        }

    fun observeStatus(workspaceKey: String): Flow<PendingSyncStatus> =
        dao.observeForWorkspace(workspaceKey).map { entities ->
            PendingSyncStatus(
                pendingCount = entities.distinctBy(PendingTodoMutationEntity::todoId).size,
                hasFailure = entities.any { it.attemptCount > 0 },
            )
        }

    internal suspend fun remove(workspaceKey: String, operationIds: List<String>) {
        if (operationIds.isNotEmpty()) dao.deleteOperations(workspaceKey, operationIds)
    }

    internal suspend fun removeTodo(workspaceKey: String, todoId: String) {
        dao.deleteForTodo(workspaceKey, todoId)
    }

    internal suspend fun recordFailure(
        workspaceKey: String,
        todoId: String,
        error: String,
        failedAt: Instant = Instant.now(),
    ) {
        val currentAttempt = dao.getForTodo(workspaceKey, todoId)
            .maxOfOrNull(PendingTodoMutationEntity::attemptCount) ?: return
        val nextAttempt = currentAttempt + 1
        dao.recordFailure(
            workspaceKey = workspaceKey,
            todoId = todoId,
            attemptedAt = failedAt.toString(),
            error = error.toOutboxError(),
            nextRetryAt = failedAt.plusSeconds(outboxRetryDelaySeconds(nextAttempt)).toString(),
        )
    }

    private fun PendingTodoMutationEntity.decodeMutation(): PendingTodoMutation? = runCatching {
        when (PendingTodoOperation.fromWire(operationType)) {
            PendingTodoOperation.CREATE -> PendingTodoCreate(
                operationId = operationId,
                todoId = todoId,
                create = pendingMutationJson.decodeFromString<TodoCreate>(payload),
                changedAt = changedAt,
            )
            PendingTodoOperation.UPDATE -> PendingTodoUpdate(
                operationId = operationId,
                todoId = todoId,
                update = pendingMutationJson.decodeFromString<TodoUpdate>(payload),
                changedAt = changedAt,
            )
            PendingTodoOperation.DELETE -> PendingTodoDelete(operationId, todoId, changedAt)
        }
    }.getOrNull()
}

private enum class PendingTodoOperation(val wireValue: String) {
    CREATE("create"), UPDATE("update"), DELETE("delete");

    companion object {
        fun fromWire(value: String): PendingTodoOperation =
            entries.firstOrNull { it.wireValue == value } ?: UPDATE
    }
}

internal fun List<PendingTodoUpdate>.mergedUpdate(): TodoUpdate =
    sortedBy(PendingTodoUpdate::changedAt)
        .fold(TodoUpdate()) { accumulated, pending -> accumulated.overlay(pending.update) }
        .copy(clientUpdatedAt = maxOfOrNull(PendingTodoUpdate::changedAt))

internal fun TodoUpdate.overlay(newer: TodoUpdate): TodoUpdate = TodoUpdate(
    title = newer.title ?: title,
    description = newer.description ?: description,
    status = newer.status ?: status,
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
        dueDate = update.dueDate ?: dueDate,
        completedAt = nextCompletedAt,
        tags = update.tags ?: tags,
        sortOrder = update.sortOrder ?: sortOrder,
        inboxState = update.inboxState ?: inboxState,
        syncStatus = "pending",
        updatedAt = changedAt,
    )
}

internal data class PendingReviewDecision(
    val reviewId: String,
    val subjectId: String,
    val decision: ReviewDecision,
    val note: String?,
    val changedAt: String,
)

@Singleton
class PendingReviewDecisionStore @Inject constructor(
    private val dao: PendingReviewDecisionDao,
    @ApplicationContext private val context: Context,
) {
    suspend fun enqueue(
        workspaceKey: String,
        reviewId: String,
        subjectId: String,
        decision: ReviewDecision,
        note: String?,
        changedAt: String = Instant.now().toString(),
    ) {
        dao.insert(
            PendingReviewDecisionEntity(
                workspaceKey = workspaceKey,
                reviewId = reviewId,
                subjectId = subjectId,
                decision = decision.wireValue,
                note = note,
                changedAt = changedAt,
            ),
        )
        TodoSyncWorkScheduler.schedule(context)
    }

    internal suspend fun forWorkspace(workspaceKey: String): List<PendingReviewDecision> =
        dao.getForWorkspace(workspaceKey).mapNotNull { entity ->
            ReviewDecision.entries.firstOrNull { it.wireValue == entity.decision }?.let { decision ->
                PendingReviewDecision(
                    reviewId = entity.reviewId,
                    subjectId = entity.subjectId,
                    decision = decision,
                    note = entity.note,
                    changedAt = entity.changedAt,
                )
            }
        }

    internal suspend fun remove(workspaceKey: String, reviewId: String) {
        dao.delete(workspaceKey, reviewId)
    }

    fun observeStatus(workspaceKey: String): Flow<PendingSyncStatus> =
        dao.observeForWorkspace(workspaceKey).map { entities ->
            PendingSyncStatus(
                pendingCount = entities.size,
                hasFailure = entities.any { it.attemptCount > 0 },
            )
        }

    internal suspend fun recordFailure(
        workspaceKey: String,
        reviewId: String,
        error: String,
        failedAt: Instant = Instant.now(),
    ) {
        val currentAttempt = dao.getForWorkspace(workspaceKey)
            .firstOrNull { it.reviewId == reviewId }
            ?.attemptCount ?: return
        val nextAttempt = currentAttempt + 1
        dao.recordFailure(
            workspaceKey = workspaceKey,
            reviewId = reviewId,
            attemptedAt = failedAt.toString(),
            error = error.toOutboxError(),
            nextRetryAt = failedAt.plusSeconds(outboxRetryDelaySeconds(nextAttempt)).toString(),
        )
    }
}

internal fun outboxRetryDelaySeconds(attempt: Int): Long {
    val exponent = (attempt - 1).coerceIn(0, 7)
    return minOf(OUTBOX_INITIAL_RETRY_SECONDS shl exponent, TimeUnit.HOURS.toSeconds(1))
}

private fun String.toOutboxError(): String =
    trim().ifBlank { "Network request failed" }.take(240)

private val ReviewDecision.wireValue: String
    get() = name.lowercase()

enum class PendingTodoSyncResult { SUCCESS, RETRY, NO_SESSION }

/** Replays workspace Todo mutations and confirmed review decisions in durable order. */
@Singleton
class PendingTodoSyncCoordinator @Inject constructor(
    private val api: ClawChatApi,
    private val reviewApi: ReviewApi,
    private val todoDao: TodoDao,
    private val store: PendingTodoUpdateStore,
    private val reviewStore: PendingReviewDecisionStore,
    private val sessionStore: SessionStore,
    private val syncManager: SyncManager,
) {
    private val operationMutex = Mutex()

    suspend fun flush(): PendingTodoSyncResult = operationMutex.withLock { flushLocked() }

    private suspend fun flushLocked(): PendingTodoSyncResult {
        val state = sessionStore.runtimeState.first()
        if (state.mode != WorkspaceMode.SERVER) return PendingTodoSyncResult.NO_SESSION
        val workspaceKey = state.workspaceKey?.takeIf(String::isNotBlank)
            ?: return PendingTodoSyncResult.NO_SESSION
        val requestScope = state.activeServerRequestScope()
            ?: return PendingTodoSyncResult.NO_SESSION
        val groups = store.allForWorkspace(workspaceKey)
            .groupBy(PendingTodoMutation::todoId)
        var todosChanged = false

        for ((todoId, pending) in groups) {
            if (sessionStore.runtimeState.first().workspaceKey != workspaceKey) {
                return PendingTodoSyncResult.NO_SESSION
            }
            when (val replay = replayTodoGroup(workspaceKey, todoId, pending, requestScope)) {
                ReplayResult.CHANGED -> todosChanged = true
                ReplayResult.UNCHANGED -> Unit
                is ReplayResult.Retry -> {
                    store.recordFailure(workspaceKey, todoId, replay.error)
                    return PendingTodoSyncResult.RETRY
                }
            }
        }

        var reviewsChanged = false
        for (pending in reviewStore.forWorkspace(workspaceKey)) {
            if (sessionStore.runtimeState.first().workspaceKey != workspaceKey) {
                return PendingTodoSyncResult.NO_SESSION
            }
            when (
                val result = apiCall {
                    reviewApi.decideReview(
                        pending.reviewId,
                        ReviewDecisionRequest(pending.decision, pending.note),
                        requestScope,
                    )
                }
            ) {
                is ApiResult.Success -> {
                    reviewStore.remove(workspaceKey, pending.reviewId)
                    reviewsChanged = true
                }
                is ApiResult.Error -> {
                    if (result.isRetryable()) {
                        reviewStore.recordFailure(workspaceKey, pending.reviewId, result.message)
                        return PendingTodoSyncResult.RETRY
                    }
                    // A conflict means another client already made a decision.
                    // Never overwrite it; discard this stale intent and refetch.
                    reviewStore.remove(workspaceKey, pending.reviewId)
                    reviewsChanged = true
                }
                ApiResult.Loading -> {
                    reviewStore.recordFailure(
                        workspaceKey,
                        pending.reviewId,
                        REQUEST_INCOMPLETE_ERROR,
                    )
                    return PendingTodoSyncResult.RETRY
                }
            }
        }

        if (todosChanged) syncManager.notifyTodoChanged()
        if (reviewsChanged) syncManager.notifyReviewChanged()
        return PendingTodoSyncResult.SUCCESS
    }

    private suspend fun replayTodoGroup(
        workspaceKey: String,
        todoId: String,
        pending: List<PendingTodoMutation>,
        requestScope: ExpectedSessionScope,
    ): ReplayResult {
        val ordered = pending.sortedBy(PendingTodoMutation::changedAt)
        val create = ordered.filterIsInstance<PendingTodoCreate>().firstOrNull()
        if (create != null) {
            return replayCreatedTodo(workspaceKey, todoId, ordered, create, requestScope)
        }

        val deletion = ordered.filterIsInstance<PendingTodoDelete>().lastOrNull()
        if (deletion != null) {
            return replayDelete(workspaceKey, todoId, ordered, requestScope)
        }

        val updates = ordered.filterIsInstance<PendingTodoUpdate>()
        if (updates.isEmpty()) return ReplayResult.UNCHANGED
        val newestChangedAt = updates.maxOf(PendingTodoUpdate::changedAt)
        return when (val remote = apiCall { api.getTodo(todoId, requestScope) }) {
            is ApiResult.Success -> {
                val winner = if (remote.data.updatedAt.toInstantOrMin() > newestChangedAt.toInstantOrMin()) {
                    remote.data
                } else {
                    when (
                        val update = apiCall {
                            api.updateTodo(
                                todoId,
                                updates.mergedUpdate().copy(clientUpdatedAt = newestChangedAt),
                                requestScope,
                            )
                        }
                    ) {
                        is ApiResult.Success -> update.data
                        is ApiResult.Error -> {
                            if (update.isRetryable()) return ReplayResult.Retry(update.message)
                            store.remove(workspaceKey, updates.map(PendingTodoUpdate::operationId))
                            return ReplayResult.UNCHANGED
                        }
                        ApiResult.Loading -> return ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
                    }
                }
                todoDao.upsertAll(listOf(winner.toEntity(workspaceKey)))
                store.remove(workspaceKey, updates.map(PendingTodoUpdate::operationId))
                ReplayResult.CHANGED
            }
            is ApiResult.Error -> when {
                remote.code == 404 -> {
                    todoDao.deleteById(workspaceKey, todoId)
                    store.removeTodo(workspaceKey, todoId)
                    ReplayResult.CHANGED
                }
                remote.isRetryable() -> ReplayResult.Retry(remote.message)
                else -> {
                    store.remove(workspaceKey, updates.map(PendingTodoUpdate::operationId))
                    ReplayResult.UNCHANGED
                }
            }
            ApiResult.Loading -> ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
        }
    }

    private suspend fun replayCreatedTodo(
        workspaceKey: String,
        localTodoId: String,
        ordered: List<PendingTodoMutation>,
        create: PendingTodoCreate,
        requestScope: ExpectedSessionScope,
    ): ReplayResult {
        val created = when (
            val result = apiCall {
                api.createTodo(
                    create.create.copy(idempotencyKey = create.operationId),
                    requestScope,
                )
            }
        ) {
            is ApiResult.Success -> result.data
            is ApiResult.Error -> {
                if (result.isRetryable()) return ReplayResult.Retry(result.message)
                store.removeTodo(workspaceKey, localTodoId)
                todoDao.deleteById(workspaceKey, localTodoId)
                return ReplayResult.CHANGED
            }
            ApiResult.Loading -> return ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
        }

        val updates = ordered.filterIsInstance<PendingTodoUpdate>()
            .filter { it.changedAt >= create.changedAt }
        val updated = if (updates.isEmpty()) {
            created
        } else {
            val newestChangedAt = updates.maxOf(PendingTodoUpdate::changedAt)
            when (
                val result = apiCall {
                    api.updateTodo(
                        created.id,
                        updates.mergedUpdate().copy(clientUpdatedAt = newestChangedAt),
                        requestScope,
                    )
                }
            ) {
                is ApiResult.Success -> result.data
                is ApiResult.Error -> {
                    if (result.isRetryable()) return ReplayResult.Retry(result.message)
                    created
                }
                ApiResult.Loading -> return ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
            }
        }

        val shouldDelete = ordered.any { it is PendingTodoDelete && it.changedAt >= create.changedAt }
        if (shouldDelete) {
            when (val result = apiCall { api.deleteTodo(created.id, requestScope) }) {
                is ApiResult.Success -> Unit
                is ApiResult.Error -> if (result.code != 404) {
                    if (result.isRetryable()) return ReplayResult.Retry(result.message)
                    todoDao.upsertAll(listOf(updated.toEntity(workspaceKey)))
                    store.removeTodo(workspaceKey, localTodoId)
                    todoDao.deleteById(workspaceKey, localTodoId)
                    return ReplayResult.CHANGED
                }
                ApiResult.Loading -> return ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
            }
            todoDao.deleteById(workspaceKey, created.id)
        } else {
            todoDao.upsertAll(listOf(updated.toEntity(workspaceKey)))
        }
        todoDao.deleteById(workspaceKey, localTodoId)
        store.removeTodo(workspaceKey, localTodoId)
        return ReplayResult.CHANGED
    }

    private suspend fun replayDelete(
        workspaceKey: String,
        todoId: String,
        ordered: List<PendingTodoMutation>,
        requestScope: ExpectedSessionScope,
    ): ReplayResult = when (val result = apiCall { api.deleteTodo(todoId, requestScope) }) {
        is ApiResult.Success -> finishDelete(workspaceKey, todoId, ordered)
        is ApiResult.Error -> when {
            result.code == 404 -> finishDelete(workspaceKey, todoId, ordered)
            result.isRetryable() -> ReplayResult.Retry(result.message)
            else -> {
                // The delete was rejected (for example by a graph constraint).
                // Restore the authoritative task instead of leaving it hidden.
                val remote = apiCall { api.getTodo(todoId, requestScope) }
                when (remote) {
                    is ApiResult.Success -> {
                        todoDao.upsertAll(listOf(remote.data.toEntity(workspaceKey)))
                    }
                    is ApiResult.Error -> if (remote.isRetryable()) {
                        return ReplayResult.Retry(remote.message)
                    }
                    ApiResult.Loading -> return ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
                }
                store.remove(workspaceKey, ordered.map(PendingTodoMutation::operationId))
                ReplayResult.CHANGED
            }
        }
        ApiResult.Loading -> ReplayResult.Retry(REQUEST_INCOMPLETE_ERROR)
    }

    private suspend fun finishDelete(
        workspaceKey: String,
        todoId: String,
        ordered: List<PendingTodoMutation>,
    ): ReplayResult {
        todoDao.deleteById(workspaceKey, todoId)
        store.remove(workspaceKey, ordered.map(PendingTodoMutation::operationId))
        return ReplayResult.CHANGED
    }

    private sealed interface ReplayResult {
        data object CHANGED : ReplayResult
        data object UNCHANGED : ReplayResult
        data class Retry(val error: String) : ReplayResult
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
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                OUTBOX_INITIAL_RETRY_SECONDS,
                TimeUnit.SECONDS,
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
