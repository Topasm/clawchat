package com.clawchat.android.core.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Updates the group badge after the user dismisses an individual reminder. */
class ReminderDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        ReminderNotificationHelper.refreshReminderSummary(context)
    }
}
