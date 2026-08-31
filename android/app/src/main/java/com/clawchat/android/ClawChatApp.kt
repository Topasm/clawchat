package com.clawchat.android

import android.app.Application
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.share.ShareOutboxNotifier
import com.clawchat.android.widget.work.WidgetWorkScheduler
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class ClawChatApp : Application() {
    @Inject lateinit var sessionCoordinator: AppSessionCoordinator

    override fun onCreate() {
        super.onCreate()
        ReminderNotificationHelper.createChannel(this)
        ShareOutboxNotifier.createChannel(this)
        WidgetWorkScheduler.schedule(this)
        sessionCoordinator.start()
    }
}
