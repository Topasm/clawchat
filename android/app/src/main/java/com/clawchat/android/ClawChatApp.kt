package com.clawchat.android

import android.app.Application
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.notification.AttentionNotificationHelper
import com.clawchat.android.notification.PushConfig
import com.clawchat.android.notification.PushTokenRegistrar
import com.clawchat.android.share.ShareOutboxNotifier
import com.clawchat.android.widget.work.WidgetWorkScheduler
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class ClawChatApp : Application() {
    @Inject lateinit var sessionCoordinator: AppSessionCoordinator
    @Inject lateinit var pushTokenRegistrar: PushTokenRegistrar

    override fun onCreate() {
        super.onCreate()
        ReminderNotificationHelper.createChannel(this)
        AttentionNotificationHelper.createChannel(this)
        ShareOutboxNotifier.createChannel(this)
        WidgetWorkScheduler.schedule(this)
        sessionCoordinator.start()
        if (PushConfig.initialize(this)) pushTokenRegistrar.start()
    }
}
