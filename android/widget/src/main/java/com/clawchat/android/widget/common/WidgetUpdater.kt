package com.clawchat.android.widget.common

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import com.clawchat.android.widget.quickadd.InboxQuickAddWidget
import com.clawchat.android.widget.tracking.TodoTrackingWidget
import com.clawchat.android.widget.tracking.WidgetRefreshKey
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** Single refresh path for callbacks, quick capture, and periodic work. */
object WidgetUpdater {
    suspend fun updateAll(context: Context) {
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        val trackingIds = manager.getGlanceIds(TodoTrackingWidget::class.java)
        val inboxIds = manager.getGlanceIds(InboxQuickAddWidget::class.java)

        coroutineScope {
            val trackingUpdates = trackingIds.map { id ->
                async {
                    updateAppWidgetState(appContext, id) { it[WidgetRefreshKey] = UUID.randomUUID().toString() }
                    TodoTrackingWidget().update(appContext, id)
                }
            }
            val inboxUpdates = inboxIds.map { id ->
                async { InboxQuickAddWidget().update(appContext, id) }
            }
            (trackingUpdates + inboxUpdates).awaitAll()
        }
    }
}
