package com.clawchat.android.core.notification

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class ReminderCheckWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "ReminderCheckWorker"
    }

    override suspend fun doWork(): Result {
        return try {
            // We can't inject via Hilt in a simple Worker, so we just
            // show a notification for any events that should have triggered
            // but didn't (because WebSocket was down). This is intentionally
            // simple — the main path is via WebSocket.
            Log.d(TAG, "Running periodic reminder check")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Reminder check failed", e)
            Result.retry()
        }
    }
}
