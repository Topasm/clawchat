package com.clawchat.android

import android.app.Application
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.notification.ReminderWorkScheduler
import com.clawchat.android.share.ShareOutboxNotifier
import com.clawchat.android.share.ShareOutboxScheduler
import com.clawchat.android.widget.work.WidgetWorkScheduler
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ClawChatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ReminderNotificationHelper.createChannel(this)
        ShareOutboxNotifier.createChannel(this)
        WidgetWorkScheduler.schedule(this)
        ReminderWorkScheduler.schedule(this)
        // WorkManager persists this unique work across process death. Calling
        // schedule at startup also recovers captures queued before login.
        ShareOutboxScheduler.schedule(this)
    }
}
