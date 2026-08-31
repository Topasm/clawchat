package com.clawchat.android.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.core.app.NotificationCompat
import com.clawchat.android.core.R

/**
 * Helper object for creating and showing reminder notifications.
 *
 * Designed as a Kotlin `object` (not Hilt-injected) so it can be called easily
 * from the [android.app.Application] class, WebSocket handlers,
 * and other contexts where dependency injection is unavailable.
 */
object ReminderNotificationHelper {

    /** Extras carried by the tap intent so the app can open the right screen. */
    const val EXTRA_REMINDER_TYPE = "reminder_type"
    const val EXTRA_ITEM_ID = "item_id"
    const val EXTRA_WORKSPACE_KEY = "workspace_key"

    private const val CHANNEL_ID = "clawchat_reminders"

    /**
     * Creates the "Reminders" notification channel.
     *
     * Safe to call multiple times — the system ignores the call if the channel
    * already exists. Should be called from [android.app.Application.onCreate].
     */
    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_reminders_channel),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.notification_reminders_channel_description)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    /**
     * Shows a reminder notification pushed via the backend WebSocket.
     *
     * @param context       Application or activity context.
     * @param reminderType  Type of reminder (e.g. "event", "task").
     * @param itemId        Backend ID of the item so the app can navigate to it.
     * @param title         Notification title.
     * @param message       Notification body text.
     */
    fun showReminderNotification(
        context: Context,
        reminderType: String,
        itemId: String,
        title: String,
        message: String,
        workspaceKey: String,
        deliveryKey: String? = null,
        deduplicate: Boolean = true,
    ): Boolean {
        // A notification without a stable workspace cannot be routed safely,
        // and an unscoped delivery claim could suppress another workspace.
        if (workspaceKey.isBlank()) return false

        // Android 13+ drops a notification posted without POST_NOTIFICATIONS,
        // and the user can switch the channel off at any time. Bail out rather
        // than build a notification nobody will see.
        if (!NotificationPermission.isGranted(context)) return false

        val manager = context.getSystemService(NotificationManager::class.java)
        val channelImportance = manager.getNotificationChannel(CHANNEL_ID)?.importance
        if (!reminderChannelAllowsNotifications(channelImportance)) {
            return false
        }

        val claimedAt = System.currentTimeMillis()
        val exactKey = deliveryKey?.takeIf(String::isNotBlank)
        val claimKey = workspaceReminderClaimKey(
            workspaceKey,
            exactKey ?: recentReminderKey(reminderType, itemId),
        )
        val suppressionWindow = if (exactKey != null) {
            EXACT_REMINDER_WINDOW_MILLIS
        } else {
            RECENT_REMINDER_WINDOW_MILLIS
        }
        val ledger = if (deduplicate) ReminderDeliveryLedger(context) else null
        if (
            ledger != null &&
            !ledger.claim(claimKey, claimedAt, suppressionWindow)
        ) {
            return false
        }

        val pendingIntent = buildPendingIntent(context, reminderType, itemId, workspaceKey)
        val notificationId = notificationId(workspaceKey, itemId)

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_clawchat)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(pendingIntent)
            .setExtras(Bundle().apply { putString(EXTRA_WORKSPACE_KEY, workspaceKey) })

        // Add "Mark Done" action for todo reminders
        if (reminderType == "todo" || reminderType == "todo_overdue") {
            val doneIntent = Intent(context, ReminderActionReceiver::class.java).apply {
                action = ReminderActionReceiver.ACTION_MARK_DONE
                putExtra("item_id", itemId)
                putExtra("notification_id", notificationId)
                putExtra(EXTRA_WORKSPACE_KEY, workspaceKey)
            }
            val donePendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId(workspaceKey, "$itemId:done"),
                doneIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.addAction(
                android.R.drawable.ic_menu_send,
                context.getString(R.string.notification_mark_done),
                donePendingIntent,
            )
        }

        return try {
            manager.notify(notificationId, builder.build())
            true
        } catch (error: RuntimeException) {
            ledger?.release(claimKey, claimedAt)
            throw error
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /**
     * Builds a [PendingIntent] that opens the app's launcher activity with
     * extras so it can navigate to the screen holding the item.
     */
    private fun buildPendingIntent(
        context: Context,
        reminderType: String,
        itemId: String,
        workspaceKey: String,
    ): PendingIntent {
        // The launcher intent resolves the app's entry activity without this
        // module reaching into the app module by class name.
        val intent = (
            context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
            ).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_REMINDER_TYPE, reminderType)
            putExtra(EXTRA_ITEM_ID, itemId)
            putExtra(EXTRA_WORKSPACE_KEY, workspaceKey)
        }
        return PendingIntent.getActivity(
            context,
            notificationId(workspaceKey, itemId),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun notificationId(workspaceKey: String, itemId: String): Int =
        "$workspaceKey:$itemId".hashCode()

    /** Removes stale reminder actions without touching update/share channels. */
    fun cancelOtherWorkspaceNotifications(context: Context, workspaceKey: String?) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications
            .asSequence()
            .filter { it.notification.channelId == CHANNEL_ID }
            .filter {
                it.notification.extras.getString(EXTRA_WORKSPACE_KEY) != workspaceKey
            }
            .forEach { manager.cancel(it.id) }
    }
}

/** A globally-enabled app can still have only its reminder channel disabled. */
internal fun reminderChannelAllowsNotifications(channelImportance: Int?): Boolean =
    channelImportance == null || channelImportance != NotificationManager.IMPORTANCE_NONE
