package com.clawchat.android.core.notification

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.clawchat.android.core.data.WorkspaceMode
import java.util.concurrent.TimeUnit

object ReminderWorkScheduler {

    private const val WORK_NAME = "clawchat_reminder_check"
    private const val IMMEDIATE_WORK_NAME = "clawchat_reminder_check_now"

    /** Keep exactly one reminder worker aligned with the active workspace. */
    fun reconcile(context: Context, mode: WorkspaceMode) {
        if (mode == WorkspaceMode.UNCONFIGURED) {
            cancel(context)
            return
        }

        // The worker reconciles with REST when it can and falls back to the
        // workspace-scoped Room cache when it cannot. Requiring connectivity
        // here would prevent that offline reminder recovery path from running.
        val constraints = Constraints.Builder().build()
        val request = PeriodicWorkRequestBuilder<ReminderCheckWorker>(
            15, TimeUnit.MINUTES,
        ).setConstraints(constraints).build()

        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(
                WORK_NAME,
                // UPDATE preserves one periodic identity while applying future
                // scheduling-policy changes without creating duplicate work.
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        runNow(context)
    }

    /** Coalesced immediate recovery after app start or a deadline change. */
    fun runNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ReminderCheckWorker>().build(),
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        WorkManager.getInstance(context).cancelUniqueWork(IMMEDIATE_WORK_NAME)
    }
}
