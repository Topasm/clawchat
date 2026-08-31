package com.clawchat.android.share

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.ShareTodoCreate
import com.clawchat.android.core.data.repository.AttachmentRepository
import com.clawchat.android.core.data.repository.ShareAttachmentUploadResult
import com.clawchat.android.core.network.ApiResult
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

internal enum class ShareOutboxRunResult {
    SUCCESS,
    RETRY,
}

@Singleton
internal class ShareOutboxProcessor @Inject constructor(
    private val store: ShareOutboxStore,
    private val sessionStore: SessionStore,
    private val repository: AttachmentRepository,
    private val notifier: ShareOutboxNotifier,
) {
    suspend fun processAll(): ShareOutboxRunResult {
        val items = store.listProcessable()
        if (items.isEmpty()) return ShareOutboxRunResult.SUCCESS
        val session = sessionStore.activeSession.first()
        if (session == null) {
            items.forEach { item ->
                store.update(
                    item.copy(
                        status = ShareOutboxStatus.WAITING_FOR_CONNECTION,
                        lastError = "session_unavailable",
                        updatedAtEpochMillis = System.currentTimeMillis(),
                    ),
                )
            }
            return ShareOutboxRunResult.RETRY
        }

        var needsRetry = false
        for (item in items) {
            when (processOne(item, session)) {
                ShareOutboxRunResult.SUCCESS -> Unit
                ShareOutboxRunResult.RETRY -> needsRetry = true
            }
        }
        return if (needsRetry) ShareOutboxRunResult.RETRY else ShareOutboxRunResult.SUCCESS
    }

    private suspend fun processOne(
        original: ShareOutboxItem,
        session: ActiveSession,
    ): ShareOutboxRunResult {
        val activeScope = session.outboxScope()
        if (activeScope == null) {
            val waiting = original.withState(
                ShareOutboxStatus.WAITING_FOR_CONNECTION,
                "workspace_unavailable",
            )
            store.update(waiting)
            notifier.connectionRequired(waiting)
            return ShareOutboxRunResult.RETRY
        }

        // A capture accepted before login is bound exactly once, before any
        // network write. Persisting the binding prevents a task from being
        // created in workspace A and its attachments uploaded to workspace B.
        val bound = if (original.targetScope == null) {
            val candidate = original.copy(
                targetScope = activeScope,
                updatedAtEpochMillis = System.currentTimeMillis(),
            )
            if (!store.update(candidate)) return ShareOutboxRunResult.RETRY
            candidate
        } else {
            original
        }
        if (bound.targetScope != activeScope) {
            val waiting = bound.withState(
                ShareOutboxStatus.WAITING_FOR_CONNECTION,
                "workspace_changed",
            )
            store.update(waiting)
            notifier.connectionRequired(waiting)
            return ShareOutboxRunResult.RETRY
        }

        var item = bound.copy(
            status = ShareOutboxStatus.RETRYING,
            attemptCount = bound.attemptCount + 1,
            lastError = null,
            updatedAtEpochMillis = System.currentTimeMillis(),
        )
        if (!store.update(item)) return ShareOutboxRunResult.RETRY

        if (item.taskId == null) {
            when (
                val result = repository.createSharedTodo(
                    ShareTodoCreate(
                        title = item.title,
                        description = item.description,
                        idempotencyKey = item.captureId,
                    ),
                    expectedScope = activeScope,
                )
            ) {
                is ApiResult.Success -> {
                    item = item.copy(
                        taskId = result.data.id,
                        updatedAtEpochMillis = System.currentTimeMillis(),
                    )
                    if (!store.update(item)) return ShareOutboxRunResult.RETRY
                }
                is ApiResult.Error -> {
                    val permanent = result.code != null &&
                        result.code in 400..499 &&
                        result.code !in RETRYABLE_HTTP_CODES
                    val failed = item.withState(
                        if (permanent) ShareOutboxStatus.FAILED_PERMANENT
                        else ShareOutboxStatus.RETRYING,
                        "todo_create_${result.code ?: "network"}",
                    )
                    store.update(failed)
                    if (permanent) notifier.failed(failed)
                    return if (permanent) ShareOutboxRunResult.SUCCESS
                    else ShareOutboxRunResult.RETRY
                }
                ApiResult.Loading -> return ShareOutboxRunResult.RETRY
            }
        }

        for (index in item.attachments.indices) {
            val attachment = item.attachments[index]
            if (attachment.uploaded) continue
            val file = store.attachmentFile(item, attachment)
            if (file == null) {
                val failed = item.withState(
                    ShareOutboxStatus.FAILED_PERMANENT,
                    "attachment_file_unavailable",
                )
                store.update(failed)
                notifier.failed(failed)
                return ShareOutboxRunResult.SUCCESS
            }

            when (
                val result = repository.uploadAttachment(
                    todoId = requireNotNull(item.taskId),
                    file = file,
                    displayName = attachment.displayName,
                    mimeType = attachment.mimeType,
                    idempotencyKey = attachment.idempotencyKey,
                    expectedScope = activeScope,
                )
            ) {
                is ShareAttachmentUploadResult.Success -> {
                    item = item.copy(
                        attachments = item.attachments.mapIndexed { current, value ->
                            if (current == index) value.copy(uploaded = true) else value
                        },
                        updatedAtEpochMillis = System.currentTimeMillis(),
                    )
                    if (!store.update(item)) return ShareOutboxRunResult.RETRY
                }
                ShareAttachmentUploadResult.DirectConnectionRequired -> {
                    val waiting = item.withState(
                        ShareOutboxStatus.DIRECT_CONNECTION_REQUIRED,
                        "attachment_exceeds_relay_limit",
                    )
                    store.update(waiting)
                    notifier.directConnectionRequired(waiting)
                    return ShareOutboxRunResult.RETRY
                }
                is ShareAttachmentUploadResult.Retryable -> {
                    store.update(item.withState(ShareOutboxStatus.RETRYING, "attachment_retry"))
                    return ShareOutboxRunResult.RETRY
                }
                is ShareAttachmentUploadResult.Permanent -> {
                    val failed = item.withState(
                        ShareOutboxStatus.FAILED_PERMANENT,
                        "attachment_rejected",
                    )
                    store.update(failed)
                    notifier.failed(failed)
                    return ShareOutboxRunResult.SUCCESS
                }
            }
        }

        notifier.saved(item)
        return if (store.discard(item.captureId)) {
            ShareOutboxRunResult.SUCCESS
        } else {
            ShareOutboxRunResult.RETRY
        }
    }

    private fun ShareOutboxItem.withState(
        status: ShareOutboxStatus,
        error: String,
    ): ShareOutboxItem = copy(
        status = status,
        lastError = error,
        updatedAtEpochMillis = System.currentTimeMillis(),
    )

    private fun ActiveSession.outboxScope(): String? = when (authMode) {
        "paired" -> hostId
        "manual" -> apiBaseUrl?.trimEnd('/')
        else -> hostId ?: apiBaseUrl?.trimEnd('/')
    }

    private companion object {
        val RETRYABLE_HTTP_CODES = setOf(401, 408, 409, 425, 429)
    }
}

class ShareOutboxWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = try {
        val processor = EntryPointAccessors.fromApplication(
            applicationContext,
            ShareOutboxWorkerEntryPoint::class.java,
        ).processor()
        when (processor.processAll()) {
            ShareOutboxRunResult.SUCCESS -> Result.success()
            ShareOutboxRunResult.RETRY -> Result.retry()
        }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        Result.retry()
    }
}

@EntryPoint
@InstallIn(SingletonComponent::class)
internal interface ShareOutboxWorkerEntryPoint {
    fun processor(): ShareOutboxProcessor
}

internal object ShareOutboxScheduler {
    private const val WORK_NAME = "clawchat_share_outbox"

    fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<ShareOutboxWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME,
            // A login/direct-connect event must not sit behind a worker that
            // is already in exponential backoff. Replacing it is safe because
            // the manifest and server writes are idempotent.
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
