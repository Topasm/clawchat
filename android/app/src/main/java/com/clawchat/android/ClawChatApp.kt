package com.clawchat.android

import android.app.Application
import com.clawchat.android.widget.work.WidgetWorkScheduler
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ClawChatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        WidgetWorkScheduler.schedule(this)
    }
}
