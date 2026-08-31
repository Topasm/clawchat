package com.clawchat.android.widget.common

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import com.clawchat.android.widget.quickadd.InboxQuickAddWidget
import com.clawchat.android.widget.tracking.TodoTrackingWidget

/** Single refresh path for callbacks, quick capture, and periodic work. */
object WidgetUpdater {
    suspend fun updateAll(context: Context) {
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        manager.getGlanceIds(TodoTrackingWidget::class.java).forEach { id ->
            TodoTrackingWidget().update(appContext, id)
        }
        manager.getGlanceIds(InboxQuickAddWidget::class.java).forEach { id ->
            InboxQuickAddWidget().update(appContext, id)
        }
    }
}
