package com.clawchat.android.widget.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.clawchat.android.widget.quickadd.InboxQuickAddWidget
import com.clawchat.android.widget.tracking.TodoTrackingWidget

class WidgetRefreshWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        TodoTrackingWidget().updateAll(applicationContext)
        InboxQuickAddWidget().updateAll(applicationContext)
        return Result.success()
    }
}
