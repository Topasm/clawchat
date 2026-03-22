package com.clawchat.android.widget.work

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.clawchat.android.widget.quickadd.InboxQuickAddWidget
import com.clawchat.android.widget.tracking.TodoTrackingWidget

class WidgetRefreshWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val manager = GlanceAppWidgetManager(applicationContext)
        for (id in manager.getGlanceIds(TodoTrackingWidget::class.java)) {
            TodoTrackingWidget().update(applicationContext, id)
        }
        for (id in manager.getGlanceIds(InboxQuickAddWidget::class.java)) {
            InboxQuickAddWidget().update(applicationContext, id)
        }
        return Result.success()
    }
}
