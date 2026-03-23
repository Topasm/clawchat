package com.clawchat.android.core.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Helper object for creating and showing reminder notifications.
 *
 * Designed as a Kotlin `object` (not Hilt-injected) so it can be called easily
 * from the [android.app.Application] class, WebSocket handlers,
 * and other contexts where dependency injection is unavailable.
 */
object ReminderNotificationHelper {

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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
    ) {
        val pendingIntent = buildPendingIntent(context, reminderType, itemId)
        val notificationId = itemId.hashCode()

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
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

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(notificationId, builder.build())
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /**
     * Builds a [PendingIntent] that opens `MainActivity` with extras so the
     * app can navigate to the relevant item.
     */
    private fun buildPendingIntent(
        context: Context,
        reminderType: String,
        itemId: String,
    ): PendingIntent {
        val intent = Intent(context, Class.forName("com.clawchat.android.MainActivity")).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("reminder_type", reminderType)
            putExtra("item_id", itemId)
        }
        return PendingIntent.getActivity(
            context,
            itemId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
