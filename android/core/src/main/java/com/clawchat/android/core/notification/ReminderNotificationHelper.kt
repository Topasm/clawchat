package com.clawchat.android.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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

    private const val CHANNEL_ID = "clawchat_reminders"
    private const val CHANNEL_NAME = "Reminders"
    private const val CHANNEL_DESCRIPTION = "Event and task reminders"

    /**
     * Creates the "Reminders" notification channel.
     *
     * Safe to call multiple times — the system ignores the call if the channel
    * already exists. Should be called from [android.app.Application.onCreate].
     */
    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = CHANNEL_DESCRIPTION
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
        deliveryKey: String? = null,
        deduplicate: Boolean = true,
    ): Boolean {
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
        val claimKey = exactKey ?: recentReminderKey(reminderType, itemId)
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

        val pendingIntent = buildPendingIntent(context, reminderType, itemId)
        val notificationId = itemId.hashCode()

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_clawchat)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(pendingIntent)

        // Add "Mark Done" action for todo reminders
        if (reminderType == "todo" || reminderType == "todo_overdue") {
            val doneIntent = Intent(context, ReminderActionReceiver::class.java).apply {
                action = ReminderActionReceiver.ACTION_MARK_DONE
                putExtra("item_id", itemId)
                putExtra("notification_id", notificationId)
            }
            val donePendingIntent = PendingIntent.getBroadcast(
                context,
                itemId.hashCode() + 1,
                doneIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.addAction(
                android.R.drawable.ic_menu_send,
                "Mark Done",
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
        }
        return PendingIntent.getActivity(
            context,
            itemId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}

/** A globally-enabled app can still have only its reminder channel disabled. */
internal fun reminderChannelAllowsNotifications(channelImportance: Int?): Boolean =
    channelImportance == null || channelImportance != NotificationManager.IMPORTANCE_NONE
