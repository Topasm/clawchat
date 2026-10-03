package com.clawchat.android.notification

import android.app.ActivityManager
import com.clawchat.android.R
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import javax.inject.Inject

/**
 * Receives pushes from the paired server and re-registers the token when
 * Firebase rotates it.
 *
 * Agent-run pushes (`type = run_state`) are data-only: this service builds the
 * notification in the user's language and points it at the run. Reminder
 * pushes carry a notification block, which Android shows itself while the app
 * is in the background; in the foreground they arrive here.
 */
@AndroidEntryPoint
class ClawChatMessagingService : FirebaseMessagingService() {

    @Inject lateinit var registrar: PushTokenRegistrar

    @Inject lateinit var sessionStore: SessionStore

    override fun onNewToken(token: String) {
        registrar.submit(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        // The notification needs the workspace it belongs to so a tap routes safely.
        val workspaceKey = runBlocking { sessionStore.runtimeState.first().workspaceKey } ?: return
        if (data["type"] == "run_state") {
            showRunState(data, workspaceKey)
            return
        }
        val itemId = data["item_id"]
        val reminderType = data["reminder_type"]
        if (data["type"] == "reminder" && message.notification == null && itemId != null && reminderType != null) {
            showReminder(data, itemId, reminderType, workspaceKey)
            return
        }
        // An older server's digest push ("You have N reminders").
        val title = message.notification?.title ?: data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: data["body"] ?: return
        ReminderNotificationHelper.showReminderNotification(
            context = this,
            reminderType = reminderType ?: data["type"] ?: "reminder",
            itemId = itemId ?: data["id"] ?: message.messageId ?: "push",
            title = title,
            message = body,
            workspaceKey = workspaceKey,
            deduplicate = false,
        )
    }

    /**
     * One reminder, data-only. It carries the server's delivery key, the same
     * one the WebSocket message has and the on-device reminder worker derives,
     * so whichever channel arrives first shows it and the others are dropped.
     */
    private fun showReminder(
        data: Map<String, String>,
        itemId: String,
        reminderType: String,
        workspaceKey: String,
    ) {
        val title = data["title"]?.takeIf(String::isNotBlank) ?: getString(R.string.app_name)
        val body = data["body"]?.takeIf(String::isNotBlank) ?: title
        ReminderNotificationHelper.showReminderNotification(
            context = this,
            reminderType = reminderType,
            itemId = itemId,
            title = title,
            message = body,
            workspaceKey = workspaceKey,
            deliveryKey = data["delivery_key"],
        )
    }

    private fun showRunState(data: Map<String, String>, workspaceKey: String) {
        // With the app open, the live screen already shows the change (toast,
        // badge, chat card); a second system notification would only repeat it.
        if (isInForeground()) return
        val runId = data["run_id"] ?: return
        val status = data["status"] ?: return
        val headline = when (status) {
            "waiting_input" -> getString(R.string.push_run_waiting_input)
            "waiting_review" -> getString(R.string.push_run_waiting_review)
            "failed" -> getString(R.string.push_run_failed)
            else -> return
        }
        val task = data["title"]?.takeIf(String::isNotBlank) ?: getString(R.string.push_run_untitled)
        val body = data["detail"]?.takeIf { status == "failed" && it.isNotBlank() }
            ?.let { getString(R.string.push_run_failed_body, task, it) }
            ?: task
        ReminderNotificationHelper.showReminderNotification(
            context = this,
            reminderType = "run",
            itemId = runId,
            title = headline,
            message = body,
            workspaceKey = workspaceKey,
            deliveryKey = "run:$runId:$status",
        )
    }

    private fun isInForeground(): Boolean {
        val state = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(state)
        return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }
}
