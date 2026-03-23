package com.clawchat.android

import android.app.Application
import com.clawchat.android.core.notification.ReminderNotificationHelper
import com.clawchat.android.core.notification.ReminderWorkScheduler
import com.clawchat.android.widget.work.WidgetWorkScheduler
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ClawChatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ReminderNotificationHelper.createChannel(this)
        WidgetWorkScheduler.schedule(this)
        ReminderWorkScheduler.schedule(this)
    }
}
