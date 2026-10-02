package com.clawchat.android.notification

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
 * Receives pushes from the paired server while the app is in the foreground
 * (in the background Android shows FCM notification messages itself) and
 * re-registers the token when Firebase rotates it.
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
        val title = message.notification?.title ?: data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: data["body"] ?: return
        // The notification needs the workspace it belongs to so a tap routes safely.
        val workspaceKey = runBlocking { sessionStore.runtimeState.first().workspaceKey } ?: return
        ReminderNotificationHelper.showReminderNotification(
            context = this,
            reminderType = data["type"] ?: "reminder",
            itemId = data["item_id"] ?: data["id"] ?: message.messageId ?: "push",
            title = title,
            message = body,
            workspaceKey = workspaceKey,
            deduplicate = false,
        )
    }
}
