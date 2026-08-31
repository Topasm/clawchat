package com.clawchat.android.share

import android.content.Context
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

internal sealed interface ShareCaptureEvent {
    data object Queued : ShareCaptureEvent
    data object QueueFull : ShareCaptureEvent
    data object Rejected : ShareCaptureEvent
    data object Malformed : ShareCaptureEvent
    data object Failed : ShareCaptureEvent
}

/** Stages incoming grants, commits an outbox transaction, then delegates delivery. */
@Singleton
class ShareCaptureCoordinator internal constructor(
    private val context: Context,
    private val sessionStore: SessionStore,
    private val contentStager: ShareContentStager,
    private val outboxStore: ShareOutboxStore,
    dispatcher: CoroutineDispatcher,
    private val scheduleDelivery: (Context) -> Unit,
) {
    @Inject
    internal constructor(
        @ApplicationContext context: Context,
        sessionStore: SessionStore,
        contentStager: ShareContentStager,
        outboxStore: ShareOutboxStore,
    ) : this(
        context = context,
        sessionStore = sessionStore,
        contentStager = contentStager,
        outboxStore = outboxStore,
        dispatcher = Dispatchers.IO,
        scheduleDelivery = ShareOutboxScheduler::schedule,
    )

    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val eventsChannel = Channel<ShareCaptureEvent>(Channel.BUFFERED)
    internal val events = eventsChannel.receiveAsFlow()

    internal fun submit(payload: IncomingSharePayload) {
        scope.launch {
            val staged = try {
                contentStager.stage(payload)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                eventsChannel.send(ShareCaptureEvent.Failed)
                return@launch
            }
            try {
                val targetScope = sessionStore.activeSession.first()?.outboxScope()
                when (
                    outboxStore.enqueue(
                        captureId = UUID.randomUUID().toString(),
                        staged = staged,
                        targetScope = targetScope,
                    )
                ) {
                    is ShareOutboxEnqueueResult.Enqueued -> {
                        eventsChannel.send(ShareCaptureEvent.Queued)
                        scheduleDelivery(context)
                    }
                    ShareOutboxEnqueueResult.Empty ->
                        eventsChannel.send(ShareCaptureEvent.Rejected)
                    ShareOutboxEnqueueResult.QueueFull ->
                        eventsChannel.send(ShareCaptureEvent.QueueFull)
                    ShareOutboxEnqueueResult.Failed ->
                        eventsChannel.send(ShareCaptureEvent.Failed)
                }
            } finally {
                // The durable outbox owns its copy after enqueue. The transient
                // cache is always removable, including rejected/over-quota work.
                staged.cleanUp()
            }
        }
    }

    internal fun malformedIntent() {
        eventsChannel.trySend(ShareCaptureEvent.Malformed)
    }

    internal fun flush() {
        scheduleDelivery(context)
    }

    private fun ActiveSession.outboxScope(): String? = when (authMode) {
        "paired" -> hostId
        "manual" -> apiBaseUrl?.trimEnd('/')
        else -> hostId ?: apiBaseUrl?.trimEnd('/')
    }

    internal fun closeForTest() {
        scope.cancel()
        eventsChannel.close()
    }
}
