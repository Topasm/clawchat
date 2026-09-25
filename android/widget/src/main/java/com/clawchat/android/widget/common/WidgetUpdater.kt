package com.clawchat.android.widget.common

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import com.clawchat.android.widget.quickadd.InboxQuickAddWidget
import com.clawchat.android.widget.tracking.TodoTrackingWidget
import com.clawchat.android.widget.tracking.WidgetRefreshKey
import java.util.UUID

/** Single refresh path for callbacks, quick capture, and periodic work. */
object WidgetUpdater {
    suspend fun updateAll(context: Context) {
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        val trackingIds = manager.getGlanceIds(TodoTrackingWidget::class.java)
        val inboxIds = manager.getGlanceIds(InboxQuickAddWidget::class.java)

        val updates = buildList<suspend () -> Unit> {
            trackingIds.forEach { id ->
                add {
                    updateAppWidgetState(appContext, id) {
                        it[WidgetRefreshKey] = UUID.randomUUID().toString()
                    }
                    TodoTrackingWidget().update(appContext, id)
                }
            }
            inboxIds.forEach { id ->
                add { InboxQuickAddWidget().update(appContext, id) }
            }
        }
        refreshWidgetsIndependently(updates)
    }
}
