package com.clawchat.android

import android.content.Context
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.notification.ReminderWorkScheduler
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.notification.AttentionNotificationCoordinator
import com.clawchat.android.share.ShareOutboxScheduler
import com.clawchat.android.widget.common.WidgetUpdater
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owns process-level work that must follow the active workspace even while no
 * Activity is started. UI collectors may come and go; connection ownership,
 * notification delivery, and persisted workers may not.
 */
@Singleton
class AppSessionCoordinator @Inject constructor(
    @ApplicationContext context: Context,
    private val sessionStore: SessionStore,
    private val syncManager: SyncManager,
    private val attentionNotifications: AttentionNotificationCoordinator,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val started = AtomicBoolean(false)

    fun start() {
        if (!started.compareAndSet(false, true)) return

        val sessionJob = scope.launch(start = CoroutineStart.LAZY) {
            var previousWorkspaceIdentity: Pair<WorkspaceMode, String?>? = null
            sessionStore.runtimeState.collectLatest { state ->
                val serverSession = state.activeSession.takeIf {
                    state.mode == WorkspaceMode.SERVER
                }
                syncManager.reconcile(
                    workspaceKey = state.workspaceKey.takeIf { serverSession != null },
                    sessionIdentity = serverSession,
                )

                val workspaceIdentity = state.mode to state.workspaceKey
                if (workspaceIdentity == previousWorkspaceIdentity) {
                    return@collectLatest
                }
                previousWorkspaceIdentity = workspaceIdentity

                ReminderWorkScheduler.reconcile(appContext, state.mode)
                ReminderNotificationHelper.cancelOtherWorkspaceNotifications(
                    appContext,
                    state.workspaceKey,
                )
                attentionNotifications.clearOtherWorkspaces(state.workspaceKey)

                if (serverSession != null) {
                    // A capture can be accepted before login. Activating its
                    // server workspace is the durable signal to retry it.
                    ShareOutboxScheduler.schedule(appContext)
                }

                // Glance rendering can suspend on a server request. collectLatest
                // cancels that request if the workspace changes again, and each
                // widget performs a final scope check before publishing content.
                updateWidgetsSafely()
                state.workspaceKey?.takeIf { serverSession != null }?.let {
                    attentionNotifications.refresh(it)
                }
            }
        }

        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            syncManager.reminder.collect { scopedReminder ->
                val reminder = scopedReminder.payload
                ReminderNotificationHelper.showReminderNotification(
                    context = appContext,
                    reminderType = reminder.reminderType,
                    itemId = reminder.itemId,
                    title = reminder.title,
                    message = reminder.message,
                    workspaceKey = scopedReminder.workspaceKey,
                    deliveryKey = reminder.deliveryKey,
                )
            }
        }

        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            syncManager.nudge.collect { scopedNudge ->
                val nudge = scopedNudge.payload
                ReminderNotificationHelper.showReminderNotification(
                    context = appContext,
                    reminderType = "nudge",
                    itemId = nudge.todoId.orEmpty(),
                    title = nudge.title,
                    message = nudge.message,
                    workspaceKey = scopedNudge.workspaceKey,
                )
            }
        }

        // Repository mutations emit immediately, before a server WebSocket echo.
        // collectLatest also coalesces the local signal and its near-simultaneous echo.
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            syncManager.todoChanged.collectLatest {
                delay(WIDGET_REFRESH_COALESCE_MILLIS)
                ReminderWorkScheduler.runNow(appContext)
                updateWidgetsSafely()
            }
        }

        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            merge(
                syncManager.todoChanged,
                syncManager.reviewChanged,
                syncManager.runChanged,
            ).collectLatest {
                delay(ATTENTION_REFRESH_COALESCE_MILLIS)
                val state = sessionStore.runtimeState.first()
                val workspaceKey = state.workspaceKey.takeIf {
                    state.mode == WorkspaceMode.SERVER && state.activeSession != null
                } ?: return@collectLatest
                attentionNotifications.refresh(workspaceKey)
            }
        }

        // Install event collectors before reconcile() can connect and emit.
        sessionJob.start()
    }

    private suspend fun updateWidgetsSafely() {
        try {
            WidgetUpdater.updateAll(appContext)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Periodic widget work remains the recovery path.
        }
    }

    private companion object {
        const val WIDGET_REFRESH_COALESCE_MILLIS = 150L
        const val ATTENTION_REFRESH_COALESCE_MILLIS = 350L
    }
}
